/*
    Generic utils for parsing OpenFOAM dictionaries
    Author: Mohammed Elwardi Fadeli
*/
'use strict';

import { Range, Position } from 'vscode-languageserver-types';
import * as KEYWORD_DATA from './data/keywords.json';
import * as RUNTIME_DATA from './data/runtimeSelection.json';

export interface KeywordEntry {
    doc?: string;
    examples?: string;
    values?: string[];
    snippet?: string;
}

export interface RuntimeEntry {
    class?: string;
    doc?: string;
    src?: string;
}

// Docs for runtime-selectable classes, harvested from OpenFOAM headers by
// tools/gen-runtime-selection.mjs (issue #15). Keyed by the TypeName
// string — the same lookup key solvers print in "Valid options" lists.
// A name can be registered by several classes (e.g. "linear"), hence the
// array.
export const RUNTIME_META: { source: string } = (RUNTIME_DATA as any)._meta;
const RUNTIME_SELECTION: { [name: string]: RuntimeEntry[] } = (RUNTIME_DATA as any).entries;

export function runtimeDoc(value: string): RuntimeEntry[] | undefined {
    return RUNTIME_SELECTION[value];
}

// Keyword knowledge base: { "<objectName|*>": { "<keyword>": KeywordEntry } }
// Single source of truth for completion, hover and signature docs.
export const KEYWORD_DB: { [object: string]: { [keyword: string]: KeywordEntry } } =
    KEYWORD_DATA as any;

// Keywords usable for a given file (FoamFile object name), universal ones included
export function keywordsFor(objectName?: string): { [keyword: string]: KeywordEntry } {
    return { ...(KEYWORD_DB[objectName] ?? {}), ...KEYWORD_DB["*"] };
}

// Flat keyword list, universal entries first (kept for API compatibility)
export const KEYWORDS = Object.keys(KEYWORD_DB)
    .sort((a, b) => a === "*" ? -1 : b === "*" ? 1 : 0)
    .reduce((all: string[], object) => all.concat(Object.keys(KEYWORD_DB[object])), [])
    .filter((keyword, i, all) => all.indexOf(keyword) === i);

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
