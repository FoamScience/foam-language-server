/*
    Folding does not have to happen on the LSP side;
    Author: Mohammed Elwardi Fadeli

    This functionality is already implemented in tree-sitter-foam:
    https://github.com/FoamScience/tree-sitter-foam
    here is how to turn it on:
    :set foldmethod=expr
    :set foldexpr=nvim_treesitter#foldexpr()
    BTW, It's not my fault that you're not using (Neo)VIM with Tree-Sitter installed

    Current Status:
    - Nothing
*/
'use strict';

import { Position, Range, TextDocument, FoldingRange, FoldingRangeKind, uinteger } from 'vscode-languageserver-types';

export class FoamFolding {

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

    // Not used currently
    private getLineLength(document: TextDocument, line: number): number {
        let text = document.getText(Range.create(line, 0, line, uinteger.MAX_VALUE));
        let length = text.length;
        let char = text.charAt(length - 1);
        while (char === '\r' || char === '\n') {
            length--;
            char = text.charAt(length - 1);
        }
        return length;
    }

    public computeFoldingRanges(content: string, lineFoldingOnly: boolean, limit: number): FoldingRange[] {
        return [];
    }

}
