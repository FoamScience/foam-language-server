/*
    Folding ranges from the tree-sitter tree: dictionaries, lists,
    inline code blocks and multi-line comments.
    (Neovim users with the foam grammar installed get this natively;
    this serves every other LSP client.)
*/
'use strict';

import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver-types';
import * as TreeParser from 'tree-sitter';

const FOLDABLE = new Set(['dict', 'dict_headless', 'list', 'code']);

export class FoamFolding {

    private treeParser: TreeParser;

    constructor(parser?: TreeParser) {
        this.treeParser = parser;
    }

    // Helper method creating folding ranges
    private createFoldingRange(foldingRangeLineFoldingOnly: boolean, startLine: number, endLine: number, startCharacter: number, endCharacter: number, kind?: FoldingRangeKind): FoldingRange {
        if (foldingRangeLineFoldingOnly) {
            return {
                startLine,
                endLine,
                kind
            }
        }
        return FoldingRange.create(startLine, endLine, startCharacter, endCharacter, kind);
    }

    public computeFoldingRanges(content: string, lineFoldingOnly: boolean, limit: number, parsedTree?: TreeParser.Tree): FoldingRange[] {
        if (!this.treeParser && !parsedTree) {
            return [];
        }
        const tree = parsedTree ?? this.treeParser.parse(content);
        const ranges: FoldingRange[] = [];
        const max = (limit === null || limit === undefined) ? Number.MAX_VALUE : limit;
        const visit = (node: TreeParser.SyntaxNode) => {
            if (ranges.length >= max) {
                return;
            }
            const spansLines = node.endPosition.row > node.startPosition.row;
            if (spansLines && (FOLDABLE.has(node.type) || node.type === 'comment')) {
                ranges.push(this.createFoldingRange(
                    lineFoldingOnly,
                    node.startPosition.row,
                    node.endPosition.row,
                    node.startPosition.column,
                    node.endPosition.column,
                    node.type === 'comment' ? FoldingRangeKind.Comment : undefined));
            }
            for (const child of node.namedChildren) {
                visit(child);
            }
        };
        visit(tree.rootNode);
        return ranges;
    }

}
