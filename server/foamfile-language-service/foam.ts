/*
    Generic utils for parsing OpenFOAM dictionaries
    Author: Mohammed Elwardi Fadeli
*/
'use strict';

import { Range, Position } from 'vscode-languageserver-types';

// Most common keywords, hopefully, all of these should have
// local docs in foamPlainText.ts and foamMarkdown.ts
export const KEYWORDS = [
    "type",
    "value",
];

// Most common preprocessor-like directives, hopefully, 
// all of these should have
// local docs in foamPlainText.ts and foamMarkdown.ts
export const DIRECTIVES = [
    "include",
    "includeEtc",
    "includeFunc",
    "includeIfPresent",
    "calc",
    "if",
    "else",
    "end",
    "codeStream",
    "neg"
];

// Native LSP snippet support, these should also be properly documented
// in foamPlainText.ts and foamMarkdown.ts
// Following Snippet syntax from:
// https://github.com/microsoft/language-server-protocol/blob/main/snippetSyntax.md
export const SNIPPETS = [
    {
        label: "boundaryCondition",
        content: "$1\n{\n\ttype ${2:someType};\n\tvalue ${3:someValue};\n$0}",
    },
];

export class Util {
    public static isWhitespace(char: string): boolean {
        return char === ' ' || char === '\t' || Util.isNewline(char);
    }

    public static isNewline(char: string): boolean {
        return char === '\r' || char === '\n';
    }

	// See if position is within a certain range, there is probably a better
    // way to do this, but oh well
    public static isInsideRange(position: Position, range: Range): boolean {
        if (range === null) {
            return false;
        } else if (range.start.line === range.end.line) {
            return range.start.line === position.line
                && range.start.character <= position.character
                && position.character <= range.end.character;
        } else if (range.start.line === position.line) {
            return range.start.character <= position.character;
        } else if (range.end.line === position.line) {
            return position.character <= range.end.character;
        }
        return range.start.line < position.line && position.line < range.end.line;
    }

    public static rangeEquals(range: Range, range2: Range) {
        return Util.positionEquals(range.start, range2.start) && Util.positionEquals(range.end, range2.end);
    }

    public static positionEquals(position: Position, position2: Position) {
        return position.line == position2.line && position.character === position2.character;
    }

    public static positionBefore(origin: Position, other: Position) {
        if (origin.line < other.line) {
            return true;
        } else if (origin.line > other.line) {
            return false;
        }
        return origin.character < other.character;
    }
}
