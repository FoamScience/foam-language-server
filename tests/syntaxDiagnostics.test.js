'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { SyntaxValidator } = require('../lib/foamfile-utils/syntaxValidator');

function parse(content) {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    return parser.parse(content);
}

describe('SyntaxValidator', () => {
    const validator = new SyntaxValidator();

    test('clean document yields no diagnostics', () => {
        const tree = parse('foo { bar 1; }\nbaz (1 2 3);\n');
        assert.deepStrictEqual(validator.validate(tree), []);
    });

    test('missing semicolon is reported as an error', () => {
        const tree = parse('foo { bar 1 }\n');
        const diags = validator.validate(tree);
        assert.ok(diags.length > 0);
        for (const d of diags) {
            assert.strictEqual(d.severity, 1); // DiagnosticSeverity.Error
            assert.strictEqual(d.source, 'tree-sitter-foam');
            assert.strictEqual(d.code, 'SYNTAX_ERROR');
        }
    });

    test('diagnostic ranges point at the offending region', () => {
        const content = 'good { key value; }\nbad ;;\n';
        const diags = validator.validate(parse(content));
        assert.ok(diags.length > 0);
        // all reported ranges are on line 1, none on the valid line 0
        for (const d of diags) {
            assert.ok(d.range.start.line >= 1, `unexpected diagnostic on line ${d.range.start.line}`);
        }
    });

    test('unclosed dict reports an error', () => {
        const diags = validator.validate(parse('foo {\n    bar 1;\n'));
        assert.ok(diags.length > 0);
    });
});
