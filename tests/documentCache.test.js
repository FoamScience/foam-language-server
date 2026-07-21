'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { DocumentCache } = require('../lib/foamfile-language-service/documentCache');

function newParser() {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    return parser;
}

// Apply a batch of changes through the cache the way the TextDocuments
// manager does: tree.edit bookkeeping first, then document update
function applyChanges(cache, document, changes) {
    cache.applyEdits(document, changes);
    const updated = TextDocument.update(document, changes, document.version + 1);
    cache.refresh(updated);
    return updated;
}

const CONTENT = `FoamFile
{
    version 2.0;
    format ascii;
    object controlDict;
}

application icoFoam;

boundaryField
{
    inlet
    {
        type fixedValue;
        value $internalField;
    }
}
`;

describe('DocumentCache incremental parsing', () => {
    test('incremental parse equals fresh parse after ranged edits', () => {
        const parser = newParser();
        const cache = new DocumentCache(parser);
        let document = TextDocument.create('file:///case/system/controlDict', 'foam', 1, CONTENT);
        cache.refresh(document);

        // replace "icoFoam" -> "pimpleFoam"
        const start1 = CONTENT.indexOf('icoFoam');
        document = applyChanges(cache, document, [{
            range: {
                start: document.positionAt(start1),
                end: document.positionAt(start1 + 'icoFoam'.length)
            },
            text: 'pimpleFoam'
        }]);

        // insert a new key-value inside the inlet dict
        const insertAt = document.getText().indexOf('type fixedValue;');
        document = applyChanges(cache, document, [{
            range: {
                start: document.positionAt(insertAt),
                end: document.positionAt(insertAt)
            },
            text: 'phi phi;\n        '
        }]);

        const incremental = cache.getTree(document.uri, document.getText());
        const fresh = newParser().parse(document.getText());
        assert.strictEqual(incremental.rootNode.toString(), fresh.rootNode.toString());
        assert.strictEqual(incremental.rootNode.hasError, false);
    });

    test('multiple changes in one batch stay consistent', () => {
        const parser = newParser();
        const cache = new DocumentCache(parser);
        let document = TextDocument.create('file:///case/0/U', 'foam', 1, CONTENT);
        cache.refresh(document);

        const off = CONTENT.indexOf('inlet');
        document = applyChanges(cache, document, [
            {
                range: { start: document.positionAt(off), end: document.positionAt(off + 5) },
                text: 'outlet'
            },
            // second change range is relative to the document after the first change
            {
                range: {
                    start: { line: 7, character: 0 },
                    end: { line: 7, character: 0 }
                },
                text: 'startTime 0;\n'
            }
        ]);

        const incremental = cache.getTree(document.uri, document.getText());
        const fresh = newParser().parse(document.getText());
        assert.strictEqual(incremental.rootNode.toString(), fresh.rootNode.toString());
    });

    test('full-document change falls back to fresh parse', () => {
        const parser = newParser();
        const cache = new DocumentCache(parser);
        let document = TextDocument.create('file:///case/0/p', 'foam', 1, CONTENT);
        cache.refresh(document);

        const newText = 'foo { bar 1; }\n';
        cache.applyEdits(document, [{ text: newText }]);
        document = TextDocument.update(document, [{ text: newText }], 2);
        cache.refresh(document);

        const incremental = cache.getTree(document.uri, document.getText());
        assert.strictEqual(incremental.rootNode.toString(), newParser().parse(newText).rootNode.toString());
    });

    test('evicted documents fall back to fresh uncached parse', () => {
        const parser = newParser();
        const cache = new DocumentCache(parser);
        const document = TextDocument.create('file:///case/0/T', 'foam', 1, CONTENT);
        cache.refresh(document);
        cache.evict(document.uri);
        const tree = cache.getTree(document.uri, CONTENT);
        assert.strictEqual(tree.rootNode.toString(), newParser().parse(CONTENT).rootNode.toString());
    });
});
