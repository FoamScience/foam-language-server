/*
    Per-document tree-sitter tree cache with incremental parsing.
    All offset conversion between LSP positions and tree-sitter indices
    lives here on purpose: native tree-sitter@0.25 indexes JS strings in
    UTF-16 code units (verified empirically), matching TextDocument.offsetAt.
*/
'use strict';

import { TextDocument, TextDocumentContentChangeEvent } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver-types';
import * as Parser from 'tree-sitter';

function toPoint(position: Position): { row: number, column: number } {
    return { row: position.line, column: position.character };
}

export class DocumentCache {

    private parser: Parser;
    private trees: Map<string, Parser.Tree> = new Map();

    constructor(parser: Parser) {
        this.parser = parser;
    }

    // Register tree.edit()s for a batch of content changes, offsets computed
    // against the pre-change document state (changes apply sequentially).
    // Must be called BEFORE TextDocument.update() applies the changes.
    public applyEdits(document: TextDocument, changes: TextDocumentContentChangeEvent[]): void {
        const tree = this.trees.get(document.uri);
        if (!tree) {
            return;
        }
        let doc = TextDocument.create(document.uri, document.languageId, document.version, document.getText());
        for (const change of changes) {
            if (!('range' in change) || !change.range) {
                // full-document replacement: incremental reuse is pointless
                this.trees.delete(document.uri);
                return;
            }
            const startIndex = doc.offsetAt(change.range.start);
            const oldEndIndex = doc.offsetAt(change.range.end);
            const newEndIndex = startIndex + change.text.length;
            const startPosition = toPoint(change.range.start);
            const oldEndPosition = toPoint(change.range.end);
            doc = TextDocument.update(doc, [change], doc.version + 1);
            tree.edit({
                startIndex,
                oldEndIndex,
                newEndIndex,
                startPosition,
                oldEndPosition,
                newEndPosition: toPoint(doc.positionAt(newEndIndex)),
            });
        }
    }

    // Reparse a document reusing the edited old tree when available.
    public refresh(document: TextDocument): Parser.Tree {
        const oldTree = this.trees.get(document.uri);
        const tree = this.parser.parse(document.getText(), oldTree);
        this.trees.set(document.uri, tree);
        return tree;
    }

    // Cached tree for open documents; fresh (uncached) parse otherwise.
    public getTree(uri: string, content: string): Parser.Tree {
        return this.trees.get(uri) ?? this.parser.parse(content);
    }

    public evict(uri: string): void {
        this.trees.delete(uri);
    }
}
