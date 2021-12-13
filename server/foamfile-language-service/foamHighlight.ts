/*
    Highlighting for OpenFOAM dictionaries
    Author: Mohammed Elwardi Fadeli

    Typically, this file will never grow; PLEASE use Tree-Sitter grammar
    for your OpenFOAM files; here is how to do it in (Neo)Vim: `:TSInstall foam`
    Simple enough huh!

    PS: Tree-Sitter queries for highlighting OpenFOAM files are located here:
    https://github.com/FoamScience/tree-sitter-foam/blob/master/queries/highlights.scm

    They already work quite well, but If you something wrong, please open an issue/PR there

    Current Status:
    - Nothing
*/
'use strict';

import {
    TextDocument, Position, DocumentHighlight, DocumentHighlightKind
} from 'vscode-languageserver-types';

export class FoamHighlight {

    public computeHighlightRanges(content: string, position: Position): DocumentHighlight[] {
        const highlights: DocumentHighlight[] = [];
        return highlights;
    }
}
