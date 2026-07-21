const { test, describe } = require('node:test');
const assert = require('node:assert');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { FoamSignatures } = require('../lib/foamfile-language-service/foamSignatures');
const { PlainTextDocumentation } = require('../lib/foamfile-language-service/foamPlainText');

function newParser() {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    return parser;
}

describe('signatures', () => {
    test('DB-backed keyword yields documentation, valid values, and parameters', () => {
        const content = `
FoamFile { object controlDict; }
stopAt endTime;
`;
        const signatures = new FoamSignatures(newParser());
        const result = signatures.computeSignatures(content, { line: 2, character: 1 });

        assert.strictEqual(result.signatures.length, 1);
        const sig = result.signatures[0];
        assert.strictEqual(sig.label, 'Keyword: stopAt');

        // Verify documentation contains the keyword doc
        assert.ok(sig.documentation.includes('When to stop the simulation'));

        // Verify documentation contains "Valid values"
        assert.ok(sig.documentation.includes('Valid values'));
        assert.ok(sig.documentation.includes('endTime'));
        assert.ok(sig.documentation.includes('writeNow'));
        assert.ok(sig.documentation.includes('noWriteNow'));
        assert.ok(sig.documentation.includes('nextWrite'));

        // Verify parameters array matches values
        assert.strictEqual(sig.parameters.length, 4);
        assert.strictEqual(sig.parameters[0].label, 'endTime');
        assert.strictEqual(sig.parameters[1].label, 'writeNow');
        assert.strictEqual(sig.parameters[2].label, 'noWriteNow');
        assert.strictEqual(sig.parameters[3].label, 'nextWrite');

        // Verify activeParameter is set
        assert.strictEqual(result.activeParameter, 0);
    });

    test('Legacy type signature unchanged (equals PlainTextDocumentation)', () => {
        const content = `
FoamFile { object transportProperties; }
type fixedValue;
`;
        const signatures = new FoamSignatures(newParser());
        const plainTextDocs = new PlainTextDocumentation();

        const result = signatures.computeSignatures(content, { line: 2, character: 1 });
        const expectedDocs = plainTextDocs.getSignatureHelp('signature_type');

        assert.strictEqual(result.signatures.length, 1);
        const sig = result.signatures[0];
        assert.strictEqual(sig.label, 'Keyword: type');
        assert.strictEqual(sig.documentation, expectedDocs);
    });

    test('Unknown keyword yields empty documentation without throwing', () => {
        const content = `
FoamFile { object unknownObject; }
unknownKeyword value;
`;
        const signatures = new FoamSignatures(newParser());

        assert.doesNotThrow(() => {
            const result = signatures.computeSignatures(content, { line: 2, character: 1 });
            assert.strictEqual(result.signatures.length, 1);
            const sig = result.signatures[0];
            assert.strictEqual(sig.label, 'Keyword: unknownKeyword');
            assert.strictEqual(sig.documentation, '');
            assert.deepStrictEqual(sig.parameters, []);
        });
    });
});
