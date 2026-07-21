'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const lsp = require('vscode-languageserver-types');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { FoamWorkspaceIndex } = require('../lib/foamfile-language-service/foamWorkspaceIndex');
const { FoamHover } = require('../lib/foamfile-language-service/foamHover');
const { MarkdownDocumentation } = require('../lib/foamfile-language-service/foamMarkdown');
const { PlainTextDocumentation } = require('../lib/foamfile-language-service/foamPlainText');

const CAVITY = path.join(__dirname, 'fixtures', 'cavity');
const NOMESH = path.join(__dirname, 'fixtures', 'cavityNoMesh');

function newParser() {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    return parser;
}

function load(root) {
    const parser = newParser();
    const index = new FoamWorkspaceIndex(parser);
    index.initialize('file://' + root);
    const hover = new FoamHover(new MarkdownDocumentation(), new PlainTextDocumentation(), parser, index);
    return { parser, index, hover, uri: (rel) => 'file://' + path.join(root, rel) };
}

// line/character of the n-th occurrence of `needle` (position of its first char)
function posOf(content, needle, occurrence = 1) {
    let from = 0;
    for (let i = 0; i < occurrence; i++) {
        from = content.indexOf(needle, from + (i > 0 ? 1 : 0));
        assert.notStrictEqual(from, -1, `needle not found: ${needle}`);
    }
    const before = content.slice(0, from);
    const line = before.split('\n').length - 1;
    const character = from - before.lastIndexOf('\n') - 1;
    return { line, character };
}

describe('index-aware hover', () => {
    test('patch hover on movingWall from 0/U shows type, mesh info and groups', () => {
        const { hover, index, uri } = load(CAVITY);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'movingWall');
        const result = hover.onHover(file.content, pos, [lsp.MarkupKind.Markdown], file.tree, file.uri);
        assert.ok(result, 'expected a hover result');
        const value = result.contents.value;
        assert.match(value, /\*\*patch\*\* `movingWall`/);
        assert.match(value, /type: wall/);
        assert.match(value, /nFaces: 20, startFace: 760/);
        assert.match(value, /groups: wall/);
        assert.match(value, /declared in constant\/polyMesh\/boundary/);
    });

    test('patch hover follows plain text markup kind', () => {
        const { hover, index, uri } = load(CAVITY);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'movingWall');
        const result = hover.onHover(file.content, pos, [lsp.MarkupKind.PlainText], file.tree, file.uri);
        assert.ok(result);
        assert.strictEqual(result.contents.kind, lsp.MarkupKind.PlainText);
        assert.doesNotMatch(result.contents.value, /[*`]/);
        assert.match(result.contents.value, /type: wall/);
    });

    test('patch group hover on wall lists member patches', () => {
        const { hover, index, uri } = load(CAVITY);
        const boundary = index.getFile(uri('constant/polyMesh/boundary'));
        const from = boundary.content.indexOf('(wall)') + 1;
        const before = boundary.content.slice(0, from);
        const pos = { line: before.split('\n').length - 1, character: from - before.lastIndexOf('\n') - 1 };
        const result = hover.onHover(boundary.content, pos, [lsp.MarkupKind.Markdown], boundary.tree, boundary.uri);
        assert.ok(result, 'expected a hover result');
        assert.match(result.contents.value, /\*\*patch group\*\* `wall`/);
        assert.match(result.contents.value, /members: movingWall, fixedWalls/);
    });

    test('macro hover on $:solver.endTime resolves the included value', () => {
        const { hover, index, uri } = load(CAVITY);
        const controlDict = index.getFile(uri('system/controlDict'));
        const pos = posOf(controlDict.content, '$:solver.endTime');
        const result = hover.onHover(controlDict.content, pos, [lsp.MarkupKind.Markdown], controlDict.tree, controlDict.uri);
        assert.ok(result, 'expected a hover result');
        assert.match(result.contents.value, /\*\*macro\*\* `\$:solver\.endTime` = `0\.5` \(from system\/params\)/);
    });

    test('scoped macro hover resolves within the same file', () => {
        const { hover, index, uri } = load(CAVITY);
        const controlDict = index.getFile(uri('system/controlDict'));
        const pos = posOf(controlDict.content, '$.writeInterval');
        const result = hover.onHover(controlDict.content, pos, [lsp.MarkupKind.Markdown], controlDict.tree, controlDict.uri);
        assert.ok(result, 'expected a hover result');
        assert.match(result.contents.value, /\*\*macro\*\* `\$\.writeInterval` = `20` \(from system\/controlDict\)/);
    });

    test('pre-mesh patch hover degrades to declaration-only info', () => {
        const { hover, index, uri } = load(NOMESH);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'movingWall');
        const result = hover.onHover(file.content, pos, [lsp.MarkupKind.Markdown], file.tree, file.uri);
        assert.ok(result, 'expected a hover result');
        const value = result.contents.value;
        assert.match(value, /\*\*patch\*\* `movingWall`/);
        assert.match(value, /type: wall/);
        assert.doesNotMatch(value, /nFaces/);
        assert.doesNotMatch(value, /groups:/);
        assert.match(value, /declared in system\/blockMeshDict/);
    });

    test('keyword hover for "type" is unaffected by the index', () => {
        const { hover, index, uri } = load(CAVITY);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'type');
        const result = hover.onHover(file.content, pos, [lsp.MarkupKind.Markdown], file.tree, file.uri);
        const docs = new MarkdownDocumentation();
        assert.ok(result);
        assert.strictEqual(result.contents.value, docs.getMarkdown('type').contents);
    });

    test('hover without a uri keeps legacy keyword-only behavior', () => {
        const { hover, index, uri } = load(CAVITY);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'type');
        const result = hover.onHover(file.content, pos, [lsp.MarkupKind.Markdown], file.tree);
        const docs = new MarkdownDocumentation();
        assert.ok(result);
        assert.strictEqual(result.contents.value, docs.getMarkdown('type').contents);
    });
});
