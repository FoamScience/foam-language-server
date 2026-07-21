'use strict';

// Real-solver integration test: runs only in a sourced OpenFOAM
// environment (CI has no OpenFOAM and skips this whole file).
const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { Validator } = require('../lib/foamfile-utils/foamValidator');

const hasOpenFOAM = !!process.env.WM_PROJECT;

describe('solver-based diagnostics (needs sourced OpenFOAM)', { skip: !hasOpenFOAM }, () => {
    test('a broken fvSchemes yields a fatal IO diagnostic', async () => {
        const fs = require('fs');
        const os = require('os');
        // copy the cavity fixture and break its fvSchemes
        const caseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foam-ls-it-'));
        fs.cpSync(path.join(__dirname, 'fixtures', 'cavity'), caseDir, { recursive: true });
        const fvSchemes = path.join(caseDir, 'system', 'fvSchemes');
        fs.writeFileSync(fvSchemes,
            fs.readFileSync(fvSchemes, 'utf-8').replace('Euler', 'notAScheme'));

        const parser = new Parser();
        parser.setLanguage(foamLanguage);
        const validator = new Validator(parser, { rootUri: 'file://' + caseDir });
        const document = TextDocument.create('file://' + fvSchemes, 'foam', 1,
            fs.readFileSync(fvSchemes, 'utf-8'));
        const [uris, diagnostics] = await validator.validateWithSolver(document);
        fs.rmSync(caseDir, { recursive: true, force: true });

        assert.ok(diagnostics.length > 0, 'expected at least one diagnostic from the solver');
        assert.ok(uris.length === diagnostics.length);
    });
});
