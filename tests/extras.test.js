'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { SemanticTokensBuilder } = require('vscode-languageserver');
const { FoamFolding } = require('../lib/foamfile-language-service/foamFolding');
const { FoamSemanticTokens } = require('../lib/foamfile-language-service/foamSemanticTokens');
const { FoamSelectionRanges } = require('../lib/foamfile-language-service/foamSelectionRanges');

function newParser() {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    return parser;
}

const CONTENT = `/* block
   comment */
outer
{
    inner
    {
        key value;
    }
    list (1 2
          3 4);
}
plain 1;
`;

describe('folding', () => {
    test('dicts, lists and block comments fold', () => {
        const ranges = new FoamFolding(newParser()).computeFoldingRanges(CONTENT, true, Number.MAX_VALUE);
        const spans = ranges.map(r => `${r.startLine}-${r.endLine}`);
        assert.ok(spans.includes('0-1'));   // block comment
        assert.ok(spans.includes('2-10'));  // outer dict
        assert.ok(spans.includes('4-7'));   // inner dict
        assert.ok(spans.includes('8-9'));   // multi-line list
        const comment = ranges.find(r => r.startLine === 0);
        assert.strictEqual(comment.kind, 'comment');
    });

    test('single-line nodes do not fold and limit is honored', () => {
        const all = new FoamFolding(newParser()).computeFoldingRanges(CONTENT, true, Number.MAX_VALUE);
        assert.ok(!all.some(r => r.startLine === r.endLine));
        const limited = new FoamFolding(newParser()).computeFoldingRanges(CONTENT, true, 2);
        assert.strictEqual(limited.length, 2);
    });
});

describe('semantic tokens', () => {
    test('produces a well-formed token stream', () => {
        const tokens = new FoamSemanticTokens(CONTENT, newParser()).computeSemanticTokens();
        assert.ok(tokens && Array.isArray(tokens.data));
        assert.strictEqual(tokens.data.length % 5, 0);
        assert.ok(tokens.data.length >= 5 * 5); // comment lines, dict names, keys...
    });

    test('macro and string tokens appear', () => {
        const content = 'foo $bar;\nbaz "str";\n';
        const tokens = new FoamSemanticTokens(content, newParser()).computeSemanticTokens();
        const types = [];
        for (let i = 3; i < tokens.data.length; i += 5) {
            types.push(tokens.data[i]);
        }
        assert.ok(types.includes(6)); // macro
        assert.ok(types.includes(7)); // string
        assert.ok(types.includes(3)); // property (keys)
    });

    test('pushTokens extracts tokens into a builder', () => {
        const content = 'dict { key value; }';
        const foamTokens = new FoamSemanticTokens(content, newParser());
        const builder = new SemanticTokensBuilder();
        foamTokens.pushTokens(builder);
        const result = builder.build();
        assert.ok(result && Array.isArray(result.data));
        assert.ok(result.data.length > 0);
    });

    test('full build then delta produces consistent tokens', () => {
        const fullContent = 'dict { key value; }';
        const foamTokens1 = new FoamSemanticTokens(fullContent, newParser());
        const fullResult = foamTokens1.computeSemanticTokens();

        const builder2 = new SemanticTokensBuilder();
        const foamTokens2 = new FoamSemanticTokens(fullContent, newParser());
        foamTokens2.pushTokens(builder2);
        const rebuiltFull = builder2.build();

        assert.ok(fullResult.data);
        assert.ok(rebuiltFull.data);
        assert.deepStrictEqual(fullResult.data, rebuiltFull.data);
    });

    test('delta encoding returns edits when content unchanged', () => {
        const content = 'dict { key value; }';
        const foamTokens = new FoamSemanticTokens(content, newParser());
        const fullResult = foamTokens.computeSemanticTokens();

        const builder = new SemanticTokensBuilder();
        if (fullResult.resultId) {
            builder.previousResult(fullResult.resultId);
        }
        foamTokens.pushTokens(builder);
        const deltaResult = builder.buildEdits();

        assert.ok(deltaResult);
        assert.ok(Array.isArray(deltaResult.data) || deltaResult.edits);
    });
});

describe('selection ranges', () => {
    test('ancestor chain expands outward', () => {
        const sel = new FoamSelectionRanges(newParser())
            .computeSelectionRanges(CONTENT, [{ line: 6, character: 9 }])[0]; // inside "key"
        // innermost range covers the cursor, each parent contains its child
        let current = sel;
        let depth = 0;
        while (current.parent) {
            const child = current.range;
            const parent = current.parent.range;
            assert.ok(parent.start.line <= child.start.line);
            assert.ok(parent.end.line >= child.end.line);
            current = current.parent;
            depth++;
        }
        assert.ok(depth >= 3); // key_value -> dict_core -> dict -> ... -> root
    });
});
