'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { FoamWorkspaceIndex } = require('../lib/foamfile-language-service/foamWorkspaceIndex');
const { FoamCase, nodeAtPosition } = require('../lib/foamfile-language-service/foamCase');
const { FoamRename } = require('../lib/foamfile-language-service/foamRename');
const { FoamReferences } = require('../lib/foamfile-language-service/foamReferences');
const { FoamDefinition } = require('../lib/foamfile-language-service/foamDefinition');
const { FoamLinks } = require('../lib/foamfile-language-service/foamLinks');

const CAVITY = path.join(__dirname, 'fixtures', 'cavity');
const NOMESH = path.join(__dirname, 'fixtures', 'cavityNoMesh');
const MULTI = path.join(__dirname, 'fixtures', 'multiRegion');

function newParser() {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    return parser;
}

function load(root) {
    const parser = newParser();
    const index = new FoamWorkspaceIndex(parser);
    index.initialize('file://' + root);
    return { parser, index, uri: (rel) => 'file://' + path.join(root, rel) };
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

describe('patch rename', () => {
    test('renaming movingWall touches all nine site kinds', () => {
        const { parser, index, uri } = load(CAVITY);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'movingWall');
        const rename = new FoamRename(parser, index);
        const edit = rename.rename({ uri: file.uri }, file.content, pos, 'lid', file.tree);
        assert.ok(edit && edit.changes);
        const byUri = edit.changes;
        const expectUris = [
            uri('0/U'), uri('0/p'),
            uri('constant/polyMesh/boundary'),
            uri('system/blockMeshDict'),
            uri('system/createPatchDict'),
            uri('system/decomposeParDict'),
            uri('system/snappyHexMeshDict'),
            uri('system/topoSetDict'),
            uri('system/fvOptions'),
        ];
        assert.deepStrictEqual(Object.keys(byUri).sort(), expectUris.sort());
        for (const u of expectUris) {
            assert.strictEqual(byUri[u].length, 1, `expected exactly one edit in ${u}`);
            assert.strictEqual(byUri[u][0].newText, 'lid');
        }
    });

    test('renaming front rewrites quoted alternations', () => {
        const { parser, index, uri } = load(CAVITY);
        const boundary = index.getFile(uri('constant/polyMesh/boundary'));
        const pos = posOf(boundary.content, 'front');
        const rename = new FoamRename(parser, index);
        const edit = rename.rename({ uri: boundary.uri }, boundary.content, pos, 'lid2', boundary.tree);
        assert.ok(edit && edit.changes);
        const uEdits = edit.changes[uri('0/U')];
        assert.strictEqual(uEdits.length, 1);
        assert.strictEqual(uEdits[0].newText, '"(lid2|back)"');
        const pEdits = edit.changes[uri('0/p')];
        assert.strictEqual(pEdits[0].newText, '"(lid2|back)"');
        // declaration edits stay plain
        assert.strictEqual(edit.changes[boundary.uri][0].newText, 'lid2');
        assert.strictEqual(edit.changes[uri('system/blockMeshDict')][0].newText, 'lid2');
        // addLayersControls/layers alternation, same rewrite rules as boundaryField
        assert.strictEqual(edit.changes[uri('system/snappyHexMeshDict')][0].newText, '"(lid2|back)"');
        // topoSetDict patches (...) list reference stays plain
        assert.strictEqual(edit.changes[uri('system/topoSetDict')][0].newText, 'lid2');
    });

    test('snappyHexMeshDict refinementSurfaces geometry keys are never renamed as patches', () => {
        const { parser, index, uri } = load(CAVITY);
        const snappy = index.getFile(uri('system/snappyHexMeshDict'));
        const pos = posOf(snappy.content, 'hull');
        const foamCase = new FoamCase(index);
        const node = nodeAtPosition(snappy.tree, pos.line, pos.character);
        const target = foamCase.classifyPosition(snappy.uri, node);
        assert.notStrictEqual(target && target.kind, 'patch');
        // findPatchSites never emits a site for the geometry surface key at all
        assert.ok(!foamCase.findPatchSites('hull').some(s => s.uri === snappy.uri));
        // renaming it (whatever generic classification it falls back to) never
        // touches any patch-bearing file
        const rename = new FoamRename(parser, index);
        const edit = rename.rename({ uri: snappy.uri }, snappy.content, pos, 'hull2', snappy.tree);
        const patchFiles = [
            uri('0/U'), uri('0/p'), uri('constant/polyMesh/boundary'),
            uri('system/blockMeshDict'), uri('system/createPatchDict'),
            uri('system/decomposeParDict'), uri('system/topoSetDict'), uri('system/fvOptions'),
        ];
        if (edit && edit.changes) {
            for (const u of patchFiles) {
                assert.strictEqual(edit.changes[u], undefined, `unexpected patch edit in ${u}`);
            }
        }
    });

    test('refinementSurfaces key sharing a name with a real patch is a display-only site: seen by references, skipped by rename', () => {
        const { parser, index, uri } = load(CAVITY);
        // CHT/snappy convention: the STL surface is named after the patch it
        // seeds. Injected via refreshFromDocument so the shared cavity fixture
        // (and its exact-reference-count assertions elsewhere) stays untouched.
        const synthetic = `
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      snappyHexMeshDict;
}

castellatedMeshControls
{
    refinementSurfaces
    {
        movingWall
        {
            level (1 1);
        }
    }
}
`;
        const snappyUri = uri('system/snappyHexMeshDict');
        const tree = parser.parse(synthetic);
        index.refreshFromDocument(snappyUri, synthetic, tree);
        const foamCase = new FoamCase(index);

        const sites = foamCase.findPatchSites('movingWall').filter(s => s.uri === snappyUri);
        assert.strictEqual(sites.length, 1);
        assert.strictEqual(sites[0].displayOnly, true);

        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'movingWall');
        const rename = new FoamRename(parser, index);
        const edit = rename.rename({ uri: file.uri }, file.content, pos, 'lid', file.tree);
        assert.ok(edit && edit.changes);
        assert.strictEqual(edit.changes[snappyUri], undefined,
            'display-only refinementSurfaces site must not receive a rename edit');
    });

    test('legacy blockMeshDict "patches ( type name (faces) ... )" declares patches', () => {
        const { parser, index, uri } = load(CAVITY);
        const legacy = `
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}

patches
(
    patch movingWall
    (
        (3 7 6 2)
    )
    wall fixedWalls
    (
        (0 4 7 3)
        (2 6 5 1)
    )
);
`;
        const tree = parser.parse(legacy);
        index.refreshFromDocument(uri('system/blockMeshDict'), legacy, tree);
        const foamCase = new FoamCase(index);
        const movingWallSites = foamCase.findPatchSites('movingWall')
            .filter(s => s.uri === uri('system/blockMeshDict'));
        assert.strictEqual(movingWallSites.length, 1);
        assert.strictEqual(movingWallSites[0].role, 'declaration');
        const fixedWallsSites = foamCase.findPatchSites('fixedWalls')
            .filter(s => s.uri === uri('system/blockMeshDict'));
        assert.strictEqual(fixedWallsSites.length, 1);
        assert.strictEqual(fixedWallsSites[0].role, 'declaration');
    });

    test('renaming the wall group edits inGroups + group selectors, not patches', () => {
        const { parser, index, uri } = load(CAVITY);
        const boundary = index.getFile(uri('constant/polyMesh/boundary'));
        const pos = posOf(boundary.content, 'wall);'); // first inGroups (wall)
        const rename = new FoamRename(parser, index);
        const edit = rename.rename({ uri: boundary.uri }, boundary.content, pos, 'walls', boundary.tree);
        assert.ok(edit && edit.changes);
        // two inGroups members + the 0/p "wall" boundaryField key
        assert.strictEqual(edit.changes[boundary.uri].length, 2);
        assert.strictEqual(edit.changes[uri('0/p')].length, 1);
        // no patch declarations touched
        assert.strictEqual(edit.changes[uri('system/blockMeshDict')], undefined);
    });

    test('prepareRename rejects numbers, include paths and non-symbols', () => {
        const { parser, index, uri } = load(CAVITY);
        const control = index.getFile(uri('system/controlDict'));
        const rename = new FoamRename(parser, index);
        // inside the "params" include string
        const includePos = posOf(control.content, 'params');
        assert.strictEqual(rename.prepareRename({ uri: control.uri }, control.content, includePos, control.tree), null);
        // on a number literal
        const numPos = posOf(control.content, '20;');
        assert.strictEqual(rename.prepareRename({ uri: control.uri }, control.content, numPos, control.tree), null);
    });

    test('rename rejects invalid new names', () => {
        const { parser, index, uri } = load(CAVITY);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'movingWall');
        const rename = new FoamRename(parser, index);
        assert.strictEqual(rename.rename({ uri: file.uri }, file.content, pos, 'bad name', file.tree), null);
        assert.strictEqual(rename.rename({ uri: file.uri }, file.content, pos, 'a;b', file.tree), null);
    });
});

describe('references and highlight', () => {
    test('references on a patch cover declarations and usages', () => {
        const { parser, index, uri } = load(CAVITY);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'movingWall');
        const refs = new FoamReferences(parser, index)
            .computeReferences({ uri: file.uri }, file.content, pos, file.tree);
        const uris = new Set(refs.map(r => r.uri));
        assert.ok(uris.has(uri('constant/polyMesh/boundary')));
        assert.ok(uris.has(uri('system/blockMeshDict')));
        assert.ok(uris.has(uri('0/U')));
        // new site kinds: snappyHexMeshDict layers key, topoSetDict sourceInfo/patch, fvOptions patch
        assert.ok(uris.has(uri('system/snappyHexMeshDict')));
        assert.ok(uris.has(uri('system/topoSetDict')));
        assert.ok(uris.has(uri('system/fvOptions')));
        assert.strictEqual(refs.length, 9);
    });

    test('highlights stay in the requested document', () => {
        const { parser, index, uri } = load(CAVITY);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'movingWall');
        const { FoamHighlight } = require('../lib/foamfile-language-service/foamHighlight');
        const highlights = new FoamHighlight(parser, index)
            .computeHighlightRanges({ uri: file.uri }, file.content, pos, file.tree);
        assert.strictEqual(highlights.length, 1);
        assert.strictEqual(highlights[0].range.start.line, pos.line);
    });
});

describe('definition', () => {
    test('boundaryField key jumps to the polyMesh declaration', () => {
        const { parser, index, uri } = load(CAVITY);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'movingWall');
        const def = new FoamDefinition(parser, index)
            .computeDefinition({ uri: file.uri }, file.content, pos, file.tree);
        assert.strictEqual(def.uri, uri('constant/polyMesh/boundary'));
    });

    test('without a mesh, falls back to blockMeshDict', () => {
        const { parser, index, uri } = load(NOMESH);
        const file = index.getFile(uri('0/U'));
        const pos = posOf(file.content, 'movingWall');
        const def = new FoamDefinition(parser, index)
            .computeDefinition({ uri: file.uri }, file.content, pos, file.tree);
        assert.strictEqual(def.uri, uri('system/blockMeshDict'));
    });

    test('absolute macro resolves across included files', () => {
        const { parser, index, uri } = load(CAVITY);
        const control = index.getFile(uri('system/controlDict'));
        const pos = posOf(control.content, 'solver.endTime');
        const def = new FoamDefinition(parser, index)
            .computeDefinition({ uri: control.uri }, control.content, pos, control.tree);
        assert.strictEqual(def.uri, uri('system/params'));
        const params = index.getFile(uri('system/params'));
        assert.strictEqual(def.range.start.line, posOf(params.content, '0.5').line);
    });

    test('relative macro $.key resolves in the current scope', () => {
        const { parser, index, uri } = load(CAVITY);
        const control = index.getFile(uri('system/controlDict'));
        const pos = posOf(control.content, '$.writeInterval');
        const def = new FoamDefinition(parser, index)
            .computeDefinition({ uri: control.uri }, control.content,
                { line: pos.line, character: pos.character + 3 }, control.tree);
        assert.strictEqual(def.uri, control.uri);
        assert.strictEqual(def.range.start.line, posOf(control.content, 'writeInterval   20').line);
    });

    test('#include jumps to the included file', () => {
        const { parser, index, uri } = load(CAVITY);
        const control = index.getFile(uri('system/controlDict'));
        const pos = posOf(control.content, '"params"');
        const def = new FoamDefinition(parser, index)
            .computeDefinition({ uri: control.uri }, control.content,
                { line: pos.line, character: pos.character + 2 }, control.tree);
        assert.strictEqual(def.uri, uri('system/params'));
    });
});

describe('key rename across includes', () => {
    test('renaming tol in params updates macros in including files', () => {
        const { parser, index, uri } = load(CAVITY);
        const params = index.getFile(uri('system/params'));
        const pos = posOf(params.content, 'tol ');
        const rename = new FoamRename(parser, index);
        const edit = rename.rename({ uri: params.uri }, params.content, pos, 'tolerance', params.tree);
        assert.ok(edit && edit.changes);
        // the key itself
        assert.ok(edit.changes[params.uri].some(e => e.newText === 'tolerance'));
        // the macro in fvSolution rewritten to $:solver.tolerance
        const fvEdits = edit.changes[uri('system/fvSolution')];
        assert.ok(fvEdits && fvEdits.some(e => e.newText === '$:solver.tolerance'));
    });
});

describe('document links', () => {
    test('include directives produce links', () => {
        const { index, uri } = load(CAVITY);
        const links = new FoamLinks(index).getLinks(uri('system/controlDict'));
        assert.strictEqual(links.length, 1);
        assert.strictEqual(links[0].target, uri('system/params'));
    });
});

describe('multi-region', () => {
    test('renaming inlet from a fluid field touches fluid files only', () => {
        const { parser, index, uri } = load(MULTI);
        const file = index.getFile(uri('0/fluid/U'));
        const pos = posOf(file.content, 'inlet');
        const rename = new FoamRename(parser, index);
        const edit = rename.rename({ uri: file.uri }, file.content, pos, 'freestream', file.tree);
        assert.ok(edit && edit.changes);
        assert.deepStrictEqual(Object.keys(edit.changes).sort(), [
            uri('0/fluid/U'), uri('0/fluid/p'),
            uri('constant/fluid/polyMesh/boundary'),
        ].sort());
        // solid's same-named inlet declaration and its field key are untouched
        assert.strictEqual(edit.changes[uri('constant/solid/polyMesh/boundary')], undefined);
        assert.strictEqual(edit.changes[uri('0/solid/T')], undefined);
        for (const u of Object.keys(edit.changes)) {
            assert.strictEqual(edit.changes[u][0].newText, 'freestream');
        }
    });

    test('renaming fluid_to_solid reaches system/fluid/decomposeParDict, never solid', () => {
        const { parser, index, uri } = load(MULTI);
        const boundary = index.getFile(uri('constant/fluid/polyMesh/boundary'));
        const pos = posOf(boundary.content, 'fluid_to_solid');
        const rename = new FoamRename(parser, index);
        const edit = rename.rename({ uri: boundary.uri }, boundary.content, pos, 'coupled', boundary.tree);
        assert.ok(edit && edit.changes);
        assert.deepStrictEqual(Object.keys(edit.changes).sort(), [
            uri('0/fluid/U'), uri('0/fluid/p'),
            uri('constant/fluid/polyMesh/boundary'),
            uri('system/fluid/decomposeParDict'),
        ].sort());
        assert.strictEqual(edit.changes[uri('system/fluid/decomposeParDict')][0].newText, 'coupled');
        assert.strictEqual(edit.changes[uri('constant/solid/polyMesh/boundary')], undefined);
        assert.strictEqual(edit.changes[uri('0/solid/T')], undefined);
    });

    test('definition of a solid boundaryField key jumps to the solid mesh', () => {
        const { parser, index, uri } = load(MULTI);
        const file = index.getFile(uri('0/solid/T'));
        const pos = posOf(file.content, 'inlet');
        const def = new FoamDefinition(parser, index)
            .computeDefinition({ uri: file.uri }, file.content, pos, file.tree);
        assert.strictEqual(def.uri, uri('constant/solid/polyMesh/boundary'));
    });

    test('references on a fluid patch stay within the fluid region', () => {
        const { parser, index, uri } = load(MULTI);
        const file = index.getFile(uri('0/fluid/p'));
        const pos = posOf(file.content, 'inlet');
        const refs = new FoamReferences(parser, index)
            .computeReferences({ uri: file.uri }, file.content, pos, file.tree);
        const uris = new Set(refs.map(r => r.uri));
        assert.ok(uris.has(uri('constant/fluid/polyMesh/boundary')));
        assert.ok(uris.has(uri('0/fluid/U')));
        assert.ok(uris.has(uri('0/fluid/p')));
        // never leaks into the solid region, whose inlet is a distinct patch
        assert.ok(!uris.has(uri('constant/solid/polyMesh/boundary')));
        assert.ok(!uris.has(uri('0/solid/T')));
    });
});
