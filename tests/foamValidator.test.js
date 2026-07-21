'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { Validator } = require('../lib/foamfile-utils/foamValidator');

function fixture(name) {
    return fs.readFileSync(path.join(__dirname, 'fixtures', 'stderr', name), 'utf-8');
}

function newValidator() {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    return new Validator(parser);
}

describe('parseFoamErrors', () => {
    test('foundation fatal IO error with valid-options list', () => {
        const errors = newValidator().parseFoamErrors(fixture('org-fatal-io-options.txt'));
        assert.strictEqual(errors.length, 1);
        const e = errors[0];
        assert.strictEqual(e.errorType, 'FOAM FATAL IO ERROR');
        assert.match(e.message, /Unknown ddtScheme type steadyStat/);
        assert.strictEqual(e.start, 26);
        assert.strictEqual(e.end, 26);
        assert.strictEqual(e.uri, 'file:///home/user/cavity/system/fvSchemes');
        assert.deepStrictEqual(e.options,
            ['CrankNicolson', 'Euler', 'backward', 'steadyState']);
    });

    test('foundation fatal IO error with line range', () => {
        const errors = newValidator().parseFoamErrors(fixture('org-fatal-io-range.txt'));
        assert.strictEqual(errors.length, 1);
        const e = errors[0];
        assert.strictEqual(e.start, 22);
        assert.strictEqual(e.end, 30);
        assert.strictEqual(e.uri, 'file:///home/user/cavity/0/p');
    });

    test('ESI fatal IO error with version tag', () => {
        const errors = newValidator().parseFoamErrors(fixture('esi-fatal-io.txt'));
        assert.strictEqual(errors.length, 1);
        const e = errors[0];
        assert.strictEqual(e.errorType, 'FOAM FATAL IO ERROR');
        assert.match(e.message, /Unknown solver type PCGG/);
        assert.ok(!e.message.includes('openfoam-2312'));
        assert.strictEqual(e.start, 25);
        assert.strictEqual(e.uri, 'file:///home/user/cavity/system/fvSolution');
        assert.ok(e.options.includes('GAMG'));
        assert.ok(e.options.includes('PCG'));
    });

    test('fatal error without case-file location', () => {
        const errors = newValidator().parseFoamErrors(fixture('org-fatal.txt'));
        assert.strictEqual(errors.length, 1);
        const e = errors[0];
        assert.strictEqual(e.errorType, 'FOAM FATAL ERROR');
        assert.match(e.message, /Continuity error cannot be removed/);
        assert.strictEqual(e.uri, undefined); // caller falls back to current doc
        assert.strictEqual(e.start, 1);
    });

    test('warning with reading-file location', () => {
        const errors = newValidator().parseFoamErrors(fixture('esi-warning.txt'));
        assert.strictEqual(errors.length, 1);
        const e = errors[0];
        assert.strictEqual(e.errorType, 'FOAM Warning');
        assert.strictEqual(e.severity, 2); // DiagnosticSeverity.Warning
        assert.strictEqual(e.start, 52);
        assert.strictEqual(e.uri, 'file:///home/user/cavity/system/controlDict');
        assert.match(e.message, /Unknown function type probess/);
    });

    test('multiple blocks in one stderr stream', () => {
        const combined = fixture('esi-warning.txt') + '\n' + fixture('org-fatal-io-options.txt');
        const errors = newValidator().parseFoamErrors(combined);
        assert.strictEqual(errors.length, 2);
        assert.strictEqual(errors[0].errorType, 'FOAM Warning');
        assert.strictEqual(errors[1].errorType, 'FOAM FATAL IO ERROR');
    });

    test('garbage stderr degrades without throwing', () => {
        const errors = newValidator().parseFoamErrors('complete nonsense\nnothing foam-shaped here\n');
        assert.deepStrictEqual(errors, []);
    });

    test('marker without parsable body still yields an error entry', () => {
        const errors = newValidator().parseFoamErrors('--> FOAM FATAL ERROR:\n\n\n');
        assert.strictEqual(errors.length, 1);
        assert.match(errors[0].message, /Couldn't parse/);
    });
});

describe('validateWithSolver guards', () => {
    test('resolves empty outside an OpenFOAM case', async () => {
        const validator = newValidator();
        const { TextDocument } = require('vscode-languageserver-textdocument');
        const doc = TextDocument.create('file:///nonexistent-dir-xyz/some/file', 'foam', 1, 'foo 1;\n');
        const [uris, diags] = await validator.validateWithSolver(doc);
        assert.deepStrictEqual(uris, []);
        assert.deepStrictEqual(diags, []);
    });
});
