/*
    Semantic tokens from tree-sitter node types. Mostly redundant for
    editors with the foam grammar installed; serves every other client.
    Supports full requests and delta encoding via SemanticTokensBuilder
*/
'use strict';

import { SemanticTokens, SemanticTokenTypes, SemanticTokenModifiers } from 'vscode-languageserver-types';
import { SemanticTokensBuilder } from 'vscode-languageserver';

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

    private content: string;
    private treeParser: TreeParser;

    constructor(content: string, parser: TreeParser) {
        this.treeParser = parser;
        this.content = content;
    }

    // semantic type of a leaf-ish node, null when the grammar highlight
    // is good enough on its own
    private tokenTypeOf(node: TreeParser.SyntaxNode): string | null {
        switch (node.type) {
            case 'comment':
                return SemanticTokenTypes.comment;
            case 'string_literal':
                return SemanticTokenTypes.string;
            case 'number_literal':
                return SemanticTokenTypes.parameter;
            case 'boolean':
                return SemanticTokenTypes.keyword;
            case 'macro':
                return SemanticTokenTypes.macro;
            case 'identifier': {
                const parent = node.parent;
                if (!parent) {
                    return null;
                }
                if (parent.type === 'preproc_call') {
                    return SemanticTokenTypes.keyword;
                }
                // positional compare — node wrapper identity is GC-dependent
                if (parent.firstNamedChild?.startIndex === node.startIndex
                    && parent.firstNamedChild?.endIndex === node.endIndex) {
                    if (parent.type === 'dict' || parent.type === 'dict_headless') {
                        return SemanticTokenTypes.namespace;
                    }
                    if (parent.type === 'key_value') {
                        return SemanticTokenTypes.property;
                    }
                }
                return SemanticTokenTypes.variable;
            }
            default:
                return null;
        }
    }

    public pushTokens(builder: SemanticTokensBuilder, parsedTree?: TreeParser.Tree): void {
        const tree = parsedTree ?? this.treeParser.parse(this.content);
        const lines = this.content.split('\n');
        const visit = (node: TreeParser.SyntaxNode) => {
            const type = this.tokenTypeOf(node);
            if (type !== null && node.type !== 'macro') {
                // multi-line tokens (block comments) must be split per line
                for (let row = node.startPosition.row; row <= node.endPosition.row; row++) {
                    const startChar = row === node.startPosition.row ? node.startPosition.column : 0;
                    const endChar = row === node.endPosition.row
                        ? node.endPosition.column
                        : (lines[row]?.length ?? 0);
                    if (endChar > startChar) {
                        builder.push(row, startChar, endChar - startChar, TokensLegend.getTokenType(type), 0);
                    }
                }
                if (node.type !== 'comment') {
                    return; // don't descend into typed leaves
                }
            }
            if (type !== null && node.type === 'macro') {
                builder.push(node.startPosition.row, node.startPosition.column,
                    node.endPosition.column - node.startPosition.column,
                    TokensLegend.getTokenType(type), 0);
                return;
            }
            for (const child of node.namedChildren) {
                visit(child);
            }
        };
        visit(tree.rootNode);
    }

    public computeSemanticTokens(parsedTree?: TreeParser.Tree): SemanticTokens {
        const tree = parsedTree ?? this.treeParser.parse(this.content);
        const builder = new SemanticTokensBuilder();
        this.pushTokens(builder, tree);
        return builder.build();
    }

}
