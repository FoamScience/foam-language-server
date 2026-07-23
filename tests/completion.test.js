'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const lsp = require('vscode-languageserver-types');
const { FoamWorkspaceIndex } = require('../lib/foamfile-language-service/foamWorkspaceIndex');
const { FoamAssist } = require('../lib/foamfile-language-service/foamAssist');

const CAVITY = path.join(__dirname, 'fixtures', 'cavity');

function newParser() {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    return parser;
}

function assist(content, uri, withIndex = true, solverOptions = [], absoluteMacroPaths = false) {
    const parser = newParser();
    let index = null;
    if (withIndex) {
        index = new FoamWorkspaceIndex(parser);
        index.initialize('file://' + CAVITY);
    }
    const document = lsp.TextDocument.create(uri ?? '', 'foam', 0, content);
    return new FoamAssist(document, [], parser, index, solverOptions, undefined, undefined, absoluteMacroPaths);
}

function posAtEnd(content, needle) {
    const at = content.indexOf(needle);
    assert.notStrictEqual(at, -1);
    const before = content.slice(0, at + needle.length);
    const line = before.split('\n').length - 1;
    return { line, character: at + needle.length - before.lastIndexOf('\n') - 1 };
}

describe('context-aware completion', () => {
    test('controlDict keywords offered in key position', () => {
        const content = 'FoamFile\n{\n    object controlDict;\n}\n\nwri\n';
        const a = assist(content, 'file:///case/system/controlDict', false);
        const props = a.computeProposals(posAtEnd(content, '\nwri'));
        const labels = props.map(p => p.label);
        assert.ok(labels.includes('writeControl'));
        assert.ok(labels.includes('writeInterval'));
        assert.ok(!labels.includes('ddtSchemes'));
    });

    test('valid values offered in value position', () => {
        const content = 'FoamFile\n{\n    object controlDict;\n}\n\nstopAt   e\n';
        const a = assist(content, 'file:///case/system/controlDict', false);
        const props = a.computeProposals(posAtEnd(content, 'stopAt   e'));
        const labels = props.map(p => p.label);
        assert.ok(labels.includes('endTime'));
        assert.ok(!labels.includes('writeNow')); // prefix-filtered by "e"
    });

    test('patch names offered as keys inside boundaryField', () => {
        const content = 'FoamFile\n{\n    object U;\n}\n\nboundaryField\n{\n    mov\n}\n';
        const a = assist(content, 'file://' + path.join(CAVITY, '0/U'));
        const props = a.computeProposals(posAtEnd(content, '    mov'));
        const labels = props.map(p => p.label);
        assert.ok(labels.includes('movingWall'));
    });

    test('boundary condition types offered for type inside boundaryField', () => {
        const content = 'FoamFile\n{\n    object U;\n}\n\nboundaryField\n{\n    inlet\n    {\n        type f\n    }\n}\n';
        const a = assist(content, 'file:///case/0/U', false);
        const props = a.computeProposals(posAtEnd(content, 'type f'));
        const labels = props.map(p => p.label);
        assert.ok(labels.includes('fixedValue'));
        assert.ok(labels.includes('fixedGradient'));
        assert.ok(!labels.includes('zeroGradient')); // prefix-filtered
    });

    test('workspace macro targets offered after $', () => {
        const content = 'FoamFile\n{\n    object controlDict;\n}\n\nendTime  $s\n';
        const a = assist(content, 'file://' + path.join(CAVITY, 'system/controlDict'));
        const props = a.computeProposals(posAtEnd(content, '$s'));
        const labels = props.map(p => p.label);
        assert.ok(labels.includes('solver.endTime'));
    });

    test('macro completion replaces only the text typed after $', () => {
        const content = 'FoamFile\n{\n    object controlDict;\n}\n\nendTime  $s\n';
        const a = assist(content, 'file://' + path.join(CAVITY, 'system/controlDict'));
        const pos = posAtEnd(content, '$s');
        const item = a.computeProposals(pos).find(p => p.label === 'solver.endTime');
        assert.ok(item.textEdit, 'macro items must state their replace range');
        assert.strictEqual(item.insertText, undefined);
        assert.strictEqual(item.textEdit.newText, 'solver.endTime');
        // range covers "s" only, the '$' stays untouched
        assert.deepStrictEqual(item.textEdit.range.start, { line: pos.line, character: pos.character - 1 });
        assert.deepStrictEqual(item.textEdit.range.end, pos);
    });

    test('in-file macro symbols get the same replace range', () => {
        const content = 'FoamFile\n{\n    object controlDict;\n}\n\nendTime 1;\nstopAt $e\n';
        const a = assist(content, 'file:///case/system/controlDict', false);
        const pos = posAtEnd(content, '$e');
        const item = a.computeProposals(pos).find(p => p.label === 'endTime');
        assert.ok(item);
        assert.strictEqual(item.textEdit.newText, 'endTime');
        assert.deepStrictEqual(item.textEdit.range.start, { line: pos.line, character: pos.character - 1 });
    });

    test('absoluteMacroPaths prepends the FoamExtend : marker', () => {
        const content = 'FoamFile\n{\n    object controlDict;\n}\n\nendTime 1;\nstopAt $e\n';
        const a = assist(content, 'file:///case/system/controlDict', false, [], true);
        const item = a.computeProposals(posAtEnd(content, '$e')).find(p => p.label === 'endTime');
        assert.strictEqual(item.textEdit.newText, ':endTime');
    });

    test('solver-harvested options rank first in value position', () => {
        const content = 'FoamFile\n{\n    object fvSchemes;\n}\n\nddtSchemes\n{\n    default st\n}\n';
        const a = assist(content, 'file:///case/system/fvSchemes', false, ['steadyState', 'Euler']);
        const props = a.computeProposals(posAtEnd(content, 'default st'));
        const fromSolver = props.filter(p => p.detail === 'from solver');
        assert.strictEqual(fromSolver.length, 1);
        assert.strictEqual(fromSolver[0].label, 'steadyState');
        assert.strictEqual(fromSolver[0].sortText, '0steadyState');
    });
});
