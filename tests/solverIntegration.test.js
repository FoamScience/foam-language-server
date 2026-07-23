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

    // The cavity fixture's controlDict uses macros current OpenFOAM
    // rejects, so real-solver tests below build their own minimal case
    // from a tutorial when one ships with the installation.
    const fs = require('fs');
    const tutorial = [
        path.join(process.env.FOAM_TUTORIALS ?? '', 'incompressible/icoFoam/cavity/cavity'),
        path.join(process.env.WM_PROJECT_DIR ?? '', 'tutorials/legacy/incompressible/icoFoam/cavity/cavity'),
    ].find(p => p && fs.existsSync(p));

    function meshedCase() {
        const os = require('os');
        const { execSync } = require('child_process');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foam-ls-real-'));
        fs.cpSync(tutorial, dir, { recursive: true });
        // ESI reads nu from transportProperties, foundation from
        // physicalProperties; supplying both keeps either fork happy
        for (const name of ['transportProperties', 'physicalProperties']) {
            const target = path.join(dir, 'constant', name);
            if (!fs.existsSync(target)) {
                fs.writeFileSync(target, 'FoamFile\n{\n    version 2.0;\n    format ascii;\n'
                    + `    class dictionary;\n    object ${name};\n}\n\nnu 0.01;\n`);
            }
        }
        execSync('blockMesh', { cwd: dir, stdio: 'ignore' });
        return dir;
    }

    test('an unknown scheme resolves to the real file and its dict path', { skip: !tutorial }, async () => {
        const dir = meshedCase();
        const fvSchemes = path.join(dir, 'system', 'fvSchemes');
        fs.writeFileSync(fvSchemes,
            fs.readFileSync(fvSchemes, 'utf-8').replace(/default\s+\w+;/, 'default banana;'));

        const parser = new Parser();
        parser.setLanguage(foamLanguage);
        const validator = new Validator(parser, { rootUri: 'file://' + dir });
        const doc = TextDocument.create('file://' + fvSchemes, 'foam', 1, fs.readFileSync(fvSchemes, 'utf-8'));
        const [uris, diagnostics, errors] = await validator.validateWithSolver(doc);
        fs.rmSync(dir, { recursive: true, force: true });

        // current OpenFOAM reports ".../system/fvSchemes/ddtSchemes/default";
        // the diagnostic belongs on the file, scoped to the dict entry
        assert.strictEqual(uris[0].uri, 'file://' + fvSchemes);
        assert.ok(!/Couldn't parse/.test(diagnostics[0].message), diagnostics[0].message);
        assert.match(diagnostics[0].message, /banana/);
        assert.deepStrictEqual(errors[0].dictPath, ['ddtSchemes', 'default']);
        assert.ok(errors[0].options.includes('Euler'),
            'the valid-options list feeds value completion');
        // no stray "$PWD is not the cwd()" warnings from the spawn
        assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics.map(d => d.message)));
    });

    test('checkMesh complaints on a bad mesh become warnings', { skip: !tutorial }, async () => {
        const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'foam-ls-badmesh-'));
        fs.cpSync(tutorial, dir, { recursive: true });
        const bmd = path.join(dir, 'system', 'blockMeshDict');
        // skew the block into a mesh checkMesh complains about
        fs.writeFileSync(bmd, fs.readFileSync(bmd, 'utf-8')
            .replace('(1 0 0)', '(1 0.9 0)').replace('(1 1 0)', '(1.02 1 0)'));
        require('child_process').execSync('blockMesh', { cwd: dir, stdio: 'ignore' });

        const parser = new Parser();
        parser.setLanguage(foamLanguage);
        const validator = new Validator(parser, { rootUri: 'file://' + dir, utilities: ['checkMesh'] });
        const target = path.join(dir, 'system', 'fvSchemes');
        const doc = TextDocument.create('file://' + target, 'foam', 1, fs.readFileSync(target, 'utf-8'));
        const [, diagnostics] = await validator.validateWithSolver(doc);
        const meshMarkerLeft = fs.existsSync(path.join(dir, 'postProcessing'));
        fs.rmSync(dir, { recursive: true, force: true });

        const fromCheckMesh = diagnostics.filter(d => d.source === 'checkMesh');
        assert.ok(fromCheckMesh.length > 0, 'expected checkMesh stdout complaints as diagnostics');
        assert.ok(fromCheckMesh.every(d => d.severity === 2), 'mesh complaints are warnings');
        assert.ok(!meshMarkerLeft, 'checkMesh must not write into the user\'s case');
    });
});
