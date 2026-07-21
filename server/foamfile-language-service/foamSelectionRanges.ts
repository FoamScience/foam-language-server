/*
    Selection ranges: expand-selection follows the tree-sitter
    ancestor chain of the node under the cursor.
*/
'use strict';

import { Position, SelectionRange } from 'vscode-languageserver-types';
import { nodeRange } from './foamCase';
import * as TreeParser from 'tree-sitter';

export class FoamSelectionRanges {

    private treeParser: TreeParser;

    constructor(parser: TreeParser) {
        this.treeParser = parser;
    }

    public computeSelectionRanges(content: string, positions: Position[], parsedTree?: TreeParser.Tree): SelectionRange[] {
        const tree = parsedTree ?? this.treeParser.parse(content);
        return positions.map((position) => {
            let node = tree.rootNode.descendantForPosition({ row: position.line, column: position.character });
            let range: SelectionRange = null;
            // build outside-in so each range wraps the previous one
            const chain: TreeParser.SyntaxNode[] = [];
            while (node) {
                chain.push(node);
                node = node.parent;
            }
            for (let i = chain.length - 1; i >= 0; i--) {
                range = SelectionRange.create(nodeRange(chain[i]), range ?? undefined);
            }
            return range ?? SelectionRange.create({
                start: position,
                end: position
            });
        });
    }
}
