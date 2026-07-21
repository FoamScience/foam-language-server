'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { FoamWorkspaceIndex } = require('../lib/foamfile-language-service/foamWorkspaceIndex');

const CAVITY = path.join(__dirname, 'fixtures', 'cavity');
const MULTI = path.join(__dirname, 'fixtures', 'multiRegion');
const uri = (rel) => 'file://' + path.join(CAVITY, rel);
const mUri = (rel) => 'file://' + path.join(MULTI, rel);

function newIndex(root = CAVITY) {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    const index = new FoamWorkspaceIndex(parser);
    index.initialize('file://' + root);
    return index;
}

describe('FoamWorkspaceIndex', () => {
    const index = newIndex();

    test('indexes all case files', () => {
        const rels = [...index.files()].map(f => f.relPath).sort();
        assert.deepStrictEqual(rels, [
            '0/U', '0/p',
            'constant/polyMesh/boundary', 'constant/transportProperties',
            'system/blockMeshDict', 'system/controlDict', 'system/createPatchDict',
            'system/decomposeParDict', 'system/fvOptions', 'system/fvSchemes', 'system/fvSolution',
            'system/params', 'system/snappyHexMeshDict', 'system/topoSetDict',
        ]);
    });

    test('classifies boundary/field/system files', () => {
        assert.deepStrictEqual(index.boundaryFiles().map(f => f.relPath), ['constant/polyMesh/boundary']);
        assert.deepStrictEqual(index.fieldFiles().map(f => f.relPath).sort(), ['0/U', '0/p']);
        assert.deepStrictEqual(index.systemFiles('fvSchemes').map(f => f.relPath), ['system/fvSchemes']);
    });

    test('extracts patch declarations with groups', () => {
        const patches = index.patchNames();
        assert.deepStrictEqual([...patches.keys()].sort(), ['back', 'fixedWalls', 'front', 'movingWall']);
        assert.deepStrictEqual(patches.get('movingWall').groups, ['wall']);
        assert.deepStrictEqual(patches.get('front').groups, []);
        assert.strictEqual(patches.get('movingWall').uri, uri('constant/polyMesh/boundary'));
    });

    test('resolves includes and reverse includes', () => {
        const incs = index.includesOf(uri('system/controlDict'));
        assert.strictEqual(incs.length, 1);
        assert.strictEqual(incs[0].directive, 'include');
        assert.strictEqual(incs[0].rawPath, 'params');
        assert.strictEqual(incs[0].targetUri, uri('system/params'));
        assert.deepStrictEqual(index.includedBy(uri('system/params')).sort(),
            [uri('system/controlDict'), uri('system/fvSolution')].sort());
        assert.deepStrictEqual(index.includeClosure(uri('system/controlDict')), [uri('system/params')]);
    });

    test('keyValueAt resolves nested dict paths', () => {
        const node = index.keyValueAt(uri('system/params'), ['solver', 'tol']);
        assert.ok(node);
        assert.strictEqual(node.text, '1e-06');
        assert.strictEqual(index.keyValueAt(uri('system/params'), ['solver', 'nope']), null);
    });

    test('macroTargets includes cross-file symbols', () => {
        const names = index.macroTargets().map(t => t.name);
        assert.ok(names.includes('solver.endTime'));
        assert.ok(names.includes('solver.tol'));
    });

    test('refreshFromDocument mirrors unsaved edits', () => {
        const idx = newIndex();
        const u = uri('system/params');
        const edited = idx.getFile(u).content.replace('tol         1e-06;', 'tolerance   1e-06;');
        idx.refreshFromDocument(u, edited);
        assert.strictEqual(idx.keyValueAt(u, ['solver', 'tol']), null);
        assert.ok(idx.keyValueAt(u, ['solver', 'tolerance']));
    });

    test('remove evicts a file', () => {
        const idx = newIndex();
        idx.remove(uri('system/params'));
        assert.strictEqual(idx.getFile(uri('system/params')), null);
        // includers' directives still point at the (on-disk) file
        assert.deepStrictEqual(idx.includedBy(uri('system/params')).sort(),
            [uri('system/controlDict'), uri('system/fvSolution')].sort());
    });
});

describe('FoamWorkspaceIndex multi-region', () => {
    const index = newIndex(MULTI);

    test('detects regions from meshes and regionProperties', () => {
        assert.deepStrictEqual([...index.knownRegions()].sort(), ['fluid', 'solid']);
        assert.strictEqual(index.regionOf('constant/fluid/polyMesh/boundary'), 'fluid');
        assert.strictEqual(index.regionOf('0/solid/T'), 'solid');
        assert.strictEqual(index.regionOf('system/fluid/decomposeParDict'), 'fluid');
        // default-region files (no region subdir) have no region
        assert.strictEqual(index.regionOf('system/controlDict'), null);
        assert.strictEqual(index.regionOf('constant/regionProperties'), null);
    });

    test('patchNames scopes to a region, no-arg merges all', () => {
        assert.deepStrictEqual([...index.patchNames('fluid').keys()].sort(),
            ['fluid_to_solid', 'inlet']);
        assert.deepStrictEqual([...index.patchNames('solid').keys()].sort(),
            ['exterior', 'inlet', 'solid_to_fluid']);
        // union across regions (same-named inlet collapses to one key)
        assert.deepStrictEqual([...index.patchNames().keys()].sort(),
            ['exterior', 'fluid_to_solid', 'inlet', 'solid_to_fluid']);
        // region-scoped inlet points at that region's own boundary file
        assert.strictEqual(index.patchNames('fluid').get('inlet').uri,
            mUri('constant/fluid/polyMesh/boundary'));
        assert.strictEqual(index.patchNames('solid').get('inlet').uri,
            mUri('constant/solid/polyMesh/boundary'));
    });

    test('fieldFiles recognizes region-nested layouts', () => {
        assert.deepStrictEqual(index.fieldFiles().map(f => f.relPath).sort(),
            ['0/fluid/U', '0/fluid/p', '0/solid/T']);
        assert.deepStrictEqual(index.boundaryFiles().map(f => f.relPath).sort(),
            ['constant/fluid/polyMesh/boundary', 'constant/solid/polyMesh/boundary']);
    });
});
