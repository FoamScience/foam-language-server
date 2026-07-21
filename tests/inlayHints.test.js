'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { FoamInlayHints } = require('../lib/foamfile-language-service/foamInlayHints');

function newParser() {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    return parser;
}

const FULL_RANGE = { start: { line: 0, character: 0 }, end: { line: 1000, character: 0 } };

describe('inlay hints', () => {
    test('kinematic-viscosity dimension set renders as m²/s', () => {
        const content = 'dimensions [0 2 -1 0 0 0 0];\n';
        const hints = new FoamInlayHints(newParser()).computeInlayHints(content, FULL_RANGE);
        assert.strictEqual(hints.length, 1);
        assert.strictEqual(hints[0].label, 'm²/s');
    });

    test('pressure dimension set renders with named unit Pa', () => {
        const content = 'dimensions [1 -1 -2 0 0 0 0];\n';
        const hints = new FoamInlayHints(newParser()).computeInlayHints(content, FULL_RANGE);
        assert.strictEqual(hints.length, 1);
        assert.strictEqual(hints[0].label, 'kg/(m·s²) (Pa)');
    });

    test('all-zero exponents render as dimensionless', () => {
        const content = 'dimensions [0 0 0 0 0 0 0];\n';
        const hints = new FoamInlayHints(newParser()).computeInlayHints(content, FULL_RANGE);
        assert.strictEqual(hints.length, 1);
        assert.strictEqual(hints[0].label, 'dimensionless');
    });

    test('hint sits right after the closing bracket, kind Type, padded', () => {
        const content = 'dimensions [0 2 -1 0 0 0 0];\n';
        const hints = new FoamInlayHints(newParser()).computeInlayHints(content, FULL_RANGE);
        assert.strictEqual(hints.length, 1);
        // `]` closes at column 27, right before the trailing `;`
        assert.deepStrictEqual(hints[0].position, { line: 0, character: 27 });
        assert.strictEqual(hints[0].kind, 1); // InlayHintKind.Type
        assert.strictEqual(hints[0].paddingLeft, true);
        assert.ok(hints[0].tooltip.includes('m^2'));
    });

    test('hints outside the requested range are excluded', () => {
        const content = 'dimensions [0 2 -1 0 0 0 0];\nnu [1 -1 -2 0 0 0 0];\n';
        const parser = newParser();
        const all = new FoamInlayHints(parser).computeInlayHints(content, FULL_RANGE);
        assert.strictEqual(all.length, 2);

        const firstLineOnly = { start: { line: 0, character: 0 }, end: { line: 0, character: 100 } };
        const filtered = new FoamInlayHints(parser).computeInlayHints(content, firstLineOnly);
        assert.strictEqual(filtered.length, 1);
        assert.strictEqual(filtered[0].label, 'm²/s');
    });

    test('inline dimensioned scalar (nu nu [...] 0.01;) is hinted', () => {
        const content = 'nu nu [0 2 -1 0 0 0 0] 0.01;\n';
        const hints = new FoamInlayHints(newParser()).computeInlayHints(content, FULL_RANGE);
        assert.strictEqual(hints.length, 1);
        assert.strictEqual(hints[0].label, 'm²/s');
        // hint sits right after `]`, before the value
        assert.strictEqual(content[hints[0].position.character - 1], ']');
    });
});
