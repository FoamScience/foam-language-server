/*
    This will probably be the one and only LSP which does NOT
    care about tokenizing semantics; because types are implicitely
    caught by Tree-Sitter nodes, and OpenFOAM has no modifier-like constructs
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Nothing
*/
'use strict';

import { Range, TextDocument, Position, SemanticTokens, SemanticTokenTypes, SemanticTokenModifiers, TextDocumentIdentifier } from 'vscode-languageserver-types';
import { Util } from './foam';

import * as TreeParser from 'tree-sitter';

export class TokensLegend {

    private static tokenTypes = {};

    private static tokenModifiers = {};
    
    public static init() {
        this.tokenTypes[SemanticTokenTypes.keyword] = 0;
        this.tokenTypes[SemanticTokenTypes.comment] = 1;
        this.tokenTypes[SemanticTokenTypes.parameter] = 2;
        this.tokenTypes[SemanticTokenTypes.property] = 3;
        this.tokenTypes[SemanticTokenTypes.namespace] = 4;
        this.tokenTypes[SemanticTokenTypes.class] = 5;
        this.tokenTypes[SemanticTokenTypes.macro] = 6;
        this.tokenTypes[SemanticTokenTypes.string] = 7;
        this.tokenTypes[SemanticTokenTypes.variable] = 8;
        this.tokenTypes[SemanticTokenTypes.operator] = 9;

        this.tokenModifiers[SemanticTokenModifiers.declaration] = 1;
        this.tokenModifiers[SemanticTokenModifiers.definition] = 2;
        this.tokenModifiers[SemanticTokenModifiers.deprecated] = 4;
    }

    public static getTokenType(type: string): number {
        const tokenType = this.tokenTypes[type];
        return tokenType;
    }

    public static getTokenModifiers(modifiers: string[]): number {
        let bit = 0;
        for (const modifier of modifiers) {
            bit |= this.tokenModifiers[modifier];
        }
        return bit;
    }
}

TokensLegend.init();

export class FoamSemanticTokens {

    private currentRange: Range | null = null;

    private content: string;
    private document: TextDocument;
    // Tokens: [start.postion, end.position, tokenType, tokenModifiers]
    private tokens = [];
    private treeParser : TreeParser;

    private quote: string = null;
    private escapedQuote: string = null;
    private readonly escapeCharacter: string;

    constructor(content: string, parser: TreeParser) {
        this.treeParser = parser;

        this.content = content;
        this.document = TextDocument.create("", "", 0, content);
        this.escapeCharacter = "\\";
        this.tokens = [];
    }

    public computeSemanticTokens(): SemanticTokens {
        return null;
    }

}
