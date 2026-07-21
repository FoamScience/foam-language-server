'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const DATA = require('../lib/foamfile-language-service/data/runtimeSelection.json');
const { runtimeDoc, RUNTIME_META } = require('../lib/foamfile-language-service/foam');
const { MarkdownDocumentation } = require('../lib/foamfile-language-service/foamMarkdown');
const { PlainTextDocumentation } = require('../lib/foamfile-language-service/foamPlainText');
const { FoamCompletion } = require('../lib/foamfile-language-service/foamCompletion');

describe('runtimeSelection data (issue #15)', () => {
    test('snapshot has meta and a sane number of entries', () => {
        assert.ok(DATA._meta.source.length > 0, '_meta.source must name the OF version');
        assert.ok(Object.keys(DATA.entries).length >= 1500,
            `expected >= 1500 names, got ${Object.keys(DATA.entries).length}`);
    });

    test('entries are arrays of {class?, doc?, src} with bounded docs', () => {
        for (const [name, entries] of Object.entries(DATA.entries)) {
            assert.ok(Array.isArray(entries) && entries.length >= 1 && entries.length <= 3,
                `${name}: 1..3 entries`);
            for (const e of entries) {
                assert.strictEqual(typeof e.src, 'string', `${name}: src required`);
                if (e.doc !== undefined) {
                    assert.ok(typeof e.doc === 'string' && e.doc.length > 0 && e.doc.length <= 450,
                        `${name}: doc must be a bounded non-empty string`);
                }
            }
        }
    });

    test('well-known runtime-selectable names resolve with docs', () => {
        for (const name of ['CrankNicolson', 'Euler', 'fixedValue', 'kOmegaSST', 'linear', 'zeroGradient']) {
            const entries = runtimeDoc(name);
            assert.ok(entries, `${name} should be in the snapshot`);
            assert.ok(entries.some(e => e.doc), `${name} should have at least one doc`);
        }
        assert.strictEqual(runtimeDoc('definitelyNotAFoamClass'), undefined);
    });
});

describe('runtime docs wiring (issue #15)', () => {
    test('hover markdown falls back to runtime class docs', () => {
        const md = new MarkdownDocumentation();
        const hover = md.getMarkdown('kOmegaSST');
        assert.ok(hover, 'hover for kOmegaSST');
        assert.ok(hover.contents.includes('k-omega'), 'contains the header description');
        assert.ok(hover.contents.includes(RUNTIME_META.source), 'names the OF version');
        assert.strictEqual(md.getMarkdown('definitelyNotAFoamClass'), undefined);
    });

    test('hand-written keyword docs still win over runtime docs', () => {
        const hover = new MarkdownDocumentation().getMarkdown('type');
        assert.ok(hover.contents.includes('Choose the type'));
    });

    test('completion docs resolve for solver-harvested options via data key', () => {
        const item = { label: 'CrankNicolson', data: 'CrankNicolson' };
        new FoamCompletion().resolveCompletionItem(item, ['markdown']);
        assert.ok(item.documentation.value.includes('Crank-Nicolson'));
    });

    test('plain text falls back to runtime class docs', () => {
        const docs = new PlainTextDocumentation().getDocumentation('zeroGradient');
        assert.ok(typeof docs === 'string' && docs.includes('zero-gradient'));
    });

    test('resolving an item without a data key does not throw (latent crash)', () => {
        const item = { label: 'somePatch' };
        assert.doesNotThrow(() => new FoamCompletion().resolveCompletionItem(item, ['markdown']));
        assert.strictEqual(item.documentation, undefined);
    });
});
