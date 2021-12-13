/*
    Symbol renaming in OpenFOAM Dictionaries doesn't make much sense
    Just use awk/sed people
    Author: Mohammed Elwardi Fadeli

    TODO: Is there a usecase for context-aware symbol renaming?
    TODO: Symbol renaming will become important in workspace-wide diagnostics
          Think of renaming a patch accross case files

    Current Status:
    - Nothing
*/
'use strict';

import { Range, Position, TextEdit, TextDocumentIdentifier } from 'vscode-languageserver-types';

export class FoamRename {

    // Prepare for renaming symbols
    public prepareRename(content: string, position: Position): Range | null {
        return null;
    }

    // Highlight ranges and send renaming edits
    public rename(textDocument: TextDocumentIdentifier, content: string, position: Position, newName: string): TextEdit[] {
        const edits: TextEdit[] = [];
        return edits;
    }
}
