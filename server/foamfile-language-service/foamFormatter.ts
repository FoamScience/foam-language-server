/*
    Not ever gonna happen! Please arrange for your text editor to
    use C++/TypeScript formatters
    Author: Mohammed Elwardi Fadeli

    PS: If anyone wants to implement formatting functionality,
    I see two options:
    - Format using Tree-Sitter understanding of dictionaries, lists and
      key-value pairs, See foamSymbols.ts file for examples
    - Pass the content to the dictionary class in OpenFOAM 
      and re-write it from there (not preferred)

    Current Status:
    - Nothing
*/
'use strict';

import {
    TextDocument, TextEdit, Position, Range, FormattingOptions,
} from 'vscode-languageserver-types';

export class FoamFormatter {

    // Helper member creating edits for formatting ends
    private createFormattingEdit(document: TextDocument, start: number, end: number, indent: boolean, indentation: string): TextEdit {
        if (indent) {
            return TextEdit.replace({
                start: document.positionAt(start),
                end: document.positionAt(end)
            }, indentation);
        } else {
            return TextEdit.del({
                start: document.positionAt(start),
                end: document.positionAt(end)
            });
        }
    }

    // Text Edits to correctly format the document
    public formatOnType(content: string, position: Position, ch: string, options: FormattingOptions): TextEdit[] {
        return [];
    }

    public formatRange(content: string, range: Range, options?: FormattingOptions): TextEdit[] {
        const lines: number[] = [];
        for (let i = range.start.line; i <= range.end.line; i++) {
            lines.push(i);
        }
        return this.format(content, lines, options);
    }

    // Perform formatting on lines from the dictioary
    private format(content: string, lines: number[], options?: FormattingOptions): TextEdit[] {
        let document = TextDocument.create("", "", 0, content);
        const indentedLines: boolean[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            indentedLines[i] = false;
        }
        return [];
    }
}
