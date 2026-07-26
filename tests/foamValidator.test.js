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
        assert.deepStrictEqual(e.dictPath, ['ddtSchemes', 'default']);
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
        assert.deepStrictEqual(e.dictPath, ['functions', 'probes']);
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

// Real stderr captured from OpenFOAM 12 (foundation) and v2412 (ESI) on the
// icoFoam cavity tutorial; the case path is templated so the parser's
// filesystem lookup can point at this repo's own cavity fixture
const CAVITY_CASE = path.join(__dirname, 'fixtures', 'cavity');
function realFixture(name) {
    return fixture(name).split('/CASE_ROOT').join(CAVITY_CASE);
}
// mirror the validator's cross-platform file URI form (forward slashes, and
// the leading slash of file:///D:/... on Windows)
function fileUri(p) {
    let s = p.replace(/\\/g, '/');
    if (!s.startsWith('/')) { s = '/' + s; }
    return 'file://' + s;
}

describe('current OpenFOAM path formats', () => {
    test('foundation: slash-separated dict path splits at the real file', () => {
        const errors = newValidator().parseFoamErrors(realFixture('org12-fatal-io-slashpath.txt'), CAVITY_CASE);
        assert.strictEqual(errors.length, 1);
        const e = errors[0];
        assert.strictEqual(e.errorType, 'FOAM FATAL IO ERROR');
        // the marker's trailing space used to blank out the whole message
        assert.strictEqual(e.message, 'Unknown ddt scheme banana');
        assert.strictEqual(e.start, 19);
        assert.strictEqual(e.uri, fileUri(path.join(CAVITY_CASE, 'system/fvSchemes')));
        assert.deepStrictEqual(e.dictPath, ['ddtSchemes', 'default']);
        assert.ok(e.options.includes('CoEuler') && e.options.includes('steadyState'));
    });

    test('ESI: a case-relative path is resolved against the case root', () => {
        const errors = newValidator().parseFoamErrors(realFixture('esi2412-fatal-io-relpath.txt'), CAVITY_CASE);
        assert.strictEqual(errors.length, 1);
        const e = errors[0];
        // ESI says "ddt type" where foundation says "ddt scheme"
        assert.strictEqual(e.message, 'Unknown ddt type banana');
        assert.strictEqual(e.uri, fileUri(path.join(CAVITY_CASE, 'system/fvSchemes')));
        assert.deepStrictEqual(e.dictPath, ['ddtSchemes', 'default']);
    });

    test('ESI deprecation IOWarnings are reported as warnings', () => {
        const errors = newValidator().parseFoamErrors(realFixture('esi2412-iowarning.txt'), CAVITY_CASE);
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].errorType, 'FOAM IOWarning');
        assert.strictEqual(errors[0].severity, 2); // DiagnosticSeverity.Warning
        assert.match(errors[0].message, /convertToMeters/);
    });

    test('an unknown case path still degrades to the dotted heuristic', () => {
        // older OpenFOAM releases, and any file deleted since the run
        const errors = newValidator().parseFoamErrors(fixture('org-fatal-io-options.txt'));
        assert.strictEqual(errors[0].uri, 'file:///home/user/cavity/system/fvSchemes');
        assert.deepStrictEqual(errors[0].dictPath, ['ddtSchemes', 'default']);
    });

    test('a bad macro relocates onto the real source line, not OpenFOAM\'s bogus one', async () => {
        // OpenFOAM reports "at line 12" for the $.writeInterval in the fixture
        // controlDict, but the macro is actually on line 22 (its line number is
        // unreliable in files with #include). The error names the macro, so we
        // find "$.writeInterval" in the real source instead.
        const { TextDocument } = require('vscode-languageserver-textdocument');
        const controlDict = path.join(CAVITY_CASE, 'system', 'controlDict');
        const parser = new Parser();
        parser.setLanguage(foamLanguage);
        const validator = new Validator(parser,
            { rootUri: 'file://' + CAVITY_CASE },
            async () => fixture('esi2412-bad-macro.txt'));
        const doc = TextDocument.create('file://' + controlDict, 'foam', 1,
            fs.readFileSync(controlDict, 'utf-8'));
        const [uris, diagnostics] = await validator.validateWithSolver(doc);

        const macroLine = fs.readFileSync(controlDict, 'utf-8').split('\n')
            .findIndex(l => l.includes('$.writeInterval'));   // 0-based
        assert.strictEqual(diagnostics.length, 1);
        assert.match(diagnostics[0].message, /writeInterval/);
        assert.strictEqual(diagnostics[0].range.start.line, macroLine);
        assert.strictEqual(uris[0].uri, fileUri(controlDict));
    });
});

describe('parseWithRules', () => {
    test('a custom rule parses user-defined banners with named groups', () => {
        const rules = [{
            name: 'my-solver',
            pattern: 'MYSOLVER ERROR: (?<message>.+?) in (?<file>\\S+) line (?<line>\\d+)(?:[\\s\\S]*?choices: \\((?<options>[^)]*)\\))?',
            severity: 'error',
        }];
        const text = 'MYSOLVER ERROR: bad scheme in /case/system/fvSchemes.ddtSchemes.default line 12\nchoices: ( Euler backward )\n';
        const errors = newValidator().parseWithRules(text, rules);
        assert.strictEqual(errors.length, 1);
        const e = errors[0];
        assert.strictEqual(e.errorType, 'my-solver');
        assert.strictEqual(e.message, 'bad scheme');
        assert.strictEqual(e.start, 12);
        assert.strictEqual(e.severity, 1); // DiagnosticSeverity.Error
        assert.strictEqual(e.uri, 'file:///case/system/fvSchemes');
        assert.deepStrictEqual(e.dictPath, ['ddtSchemes', 'default']);
        assert.deepStrictEqual(e.options, ['Euler', 'backward']);
    });

    test('an invalid custom rule regex degrades to a warning, never throws', () => {
        const errors = newValidator().parseWithRules('anything', [{ pattern: '(' }]);
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].severity, 2);
        assert.match(errors[0].message, /Invalid custom rule/);
    });
});

describe('utility-based diagnostics', () => {
    test('utilities run in a scratch copy and their stdout is parsed', async () => {
        const os = require('os');
        const { TextDocument } = require('vscode-languageserver-textdocument');
        const caseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foam-ls-util-'));
        fs.mkdirSync(path.join(caseDir, 'system'));
        fs.writeFileSync(path.join(caseDir, 'system', 'controlDict'), 'application doesNotExistFoam;\n');
        // stand-in utility: writes a marker into its cwd (must be the
        // scratch copy, not the user's case) and complains on stdout
        const script = path.join(caseDir, 'utility.js');
        fs.writeFileSync(script,
            'require("fs").writeFileSync("marker.txt", "x");\n' +
            'console.log("***Boundary openness is off the charts.");\n');

        const parser = new Parser();
        parser.setLanguage(foamLanguage);
        const validator = new Validator(parser, {
            rootUri: 'file://' + caseDir,
            utilities: [process.execPath + ' ' + script],
        });
        const doc = TextDocument.create('file://' + path.join(caseDir, 'system', 'controlDict'), 'foam', 1, '');
        const [, diagnostics] = await validator.validateWithSolver(doc);

        const untouched = !fs.existsSync(path.join(caseDir, 'marker.txt'));
        fs.rmSync(caseDir, { recursive: true, force: true });
        assert.ok(untouched, 'the utility ran in the user\'s case, not the scratch copy');
        const meshCheck = diagnostics.find(d => d.message.includes('Boundary openness'));
        assert.ok(meshCheck, 'expected the *** stdout line to become a diagnostic');
        assert.strictEqual(meshCheck.severity, 2); // DiagnosticSeverity.Warning
        assert.strictEqual(meshCheck.source, process.execPath);
    });

    test('a utility complaint that names no file is dropped, not pinned on the open document', async () => {
        // setFields without a setFieldsDict: environmental, and nothing to
        // do with whichever file the user happens to be editing
        const os = require('os');
        const { TextDocument } = require('vscode-languageserver-textdocument');
        const caseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foam-ls-noise-'));
        fs.mkdirSync(path.join(caseDir, 'system'));
        fs.writeFileSync(path.join(caseDir, 'system', 'controlDict'), 'application doesNotExistFoam;\n');
        const script = path.join(caseDir, 'utility.js');
        fs.writeFileSync(script, 'process.stderr.write(' +
            JSON.stringify(fixture('org12-setfields-missing-dict.txt')) + ');\n');

        const parser = new Parser();
        parser.setLanguage(foamLanguage);
        const validator = new Validator(parser, {
            rootUri: 'file://' + caseDir,
            utilities: [process.execPath + ' ' + script],
        });
        const doc = TextDocument.create('file://' + path.join(caseDir, 'system', 'controlDict'), 'foam', 1, '');
        const [, diagnostics] = await validator.validateWithSolver(doc);
        fs.rmSync(caseDir, { recursive: true, force: true });
        assert.deepStrictEqual(diagnostics, []);
    });

    // Unix-only: the stand-in utility is a /bin/sh script and the behaviour
    // under test ($PWD vs cwd()) is an ESI-OpenFOAM-on-Unix concern
    test('spawned programs see PWD matching their cwd', { skip: process.platform === 'win32' }, async () => {
        // ESI OpenFOAM warns on every run when $PWD disagrees with cwd(),
        // which it always does for a server spawned from the editor's dir
        const os = require('os');
        const { TextDocument } = require('vscode-languageserver-textdocument');
        const caseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foam-ls-pwd-'));
        fs.mkdirSync(path.join(caseDir, 'system'));
        fs.writeFileSync(path.join(caseDir, 'system', 'controlDict'), 'application doesNotExistFoam;\n');
        const script = path.join(caseDir, 'echoPwd.sh');
        fs.writeFileSync(script, '#!/bin/sh\n'
            + 'if [ "$(cd "$PWD" 2>/dev/null && pwd -P)" = "$(pwd -P)" ]; then\n'
            + '  echo "***PWD-MATCHES-CWD"\n'
            + 'else\n'
            + '  echo "***PWD-MISMATCH $PWD"\n'
            + 'fi\n');
        fs.chmodSync(script, 0o755);

        const parser = new Parser();
        parser.setLanguage(foamLanguage);
        const validator = new Validator(parser, { rootUri: 'file://' + caseDir, utilities: [script] });
        const doc = TextDocument.create('file://' + path.join(caseDir, 'system', 'controlDict'), 'foam', 1, '');
        const [, diagnostics] = await validator.validateWithSolver(doc);
        fs.rmSync(caseDir, { recursive: true, force: true });
        assert.strictEqual(diagnostics.length, 1);
        assert.match(diagnostics[0].message, /PWD-MATCHES-CWD/);
    });

    test('warning severity setting can suppress FOAM Warnings', async () => {
        const { TextDocument } = require('vscode-languageserver-textdocument');
        const { ValidationSeverity } = require('../lib/foamfile-utils/main');
        const CAVITY = path.join(__dirname, 'fixtures', 'cavity');
        const parser = new Parser();
        parser.setLanguage(foamLanguage);
        const validator = new Validator(parser,
            { rootUri: 'file://' + CAVITY, warning: ValidationSeverity.IGNORE },
            async () => fixture('esi-warning.txt'));
        const doc = TextDocument.create('file://' + path.join(CAVITY, 'system', 'controlDict'), 'foam', 1, '');
        const [, diagnostics] = await validator.validateWithSolver(doc);
        assert.deepStrictEqual(diagnostics, []);
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
