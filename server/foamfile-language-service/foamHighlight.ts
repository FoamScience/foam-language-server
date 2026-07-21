/*
    Highlighting occurrences of the symbol under the cursor
    (patches, macros, keys) — same-file slice of find-all-references.
*/
'use strict';

import {
    Position, DocumentHighlight, TextDocumentIdentifier
} from 'vscode-languageserver-types';
import { FoamWorkspaceIndex } from './foamWorkspaceIndex';
import { FoamReferences } from './foamReferences';
import * as TreeParser from 'tree-sitter';

export class FoamHighlight {

    private treeParser: TreeParser;
    private index: FoamWorkspaceIndex | null;

    constructor(parser?: TreeParser, index?: FoamWorkspaceIndex) {
        this.treeParser = parser;
        this.index = index ?? null;
    }

    public computeHighlightRanges(textDocument: TextDocumentIdentifier, content: string, position: Position, parsedTree?: TreeParser.Tree): DocumentHighlight[] {
        if (!this.treeParser) {
            return [];
        }
        return new FoamReferences(this.treeParser, this.index)
            .computeHighlights(textDocument, content, position, parsedTree);
    }
}
