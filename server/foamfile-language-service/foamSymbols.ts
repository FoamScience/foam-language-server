/*
    Extract symbols and their URI locations in OpenFOAM dictionaries
    Author: Mohammed Elwardi Fadeli

    TODO: How about going workspace-wide with symbol extraction?

    This is done using only the Tree-Sitter for OpenFOAM, no native
    OpenFOAM parser is involved.

    CurrentStatus:
    - Support for exploring all symbols in a document, including the ones under lists
*/
'use strict';

import { TextDocument, SymbolInformation, SymbolKind, Range, TextDocumentIdentifier } from 'vscode-languageserver-types';
import { writeFile,readFileSync } from 'fs';
import * as TreeParser from 'tree-sitter';

export class FoamSymbols {

    private treeParser : TreeParser;

    constructor(parser : TreeParser) {
        this.treeParser = parser;
    }

    private createSymbolInformation(name: string, textDocumentURI: string, range: Range, kind: SymbolKind, deprecated: boolean): SymbolInformation {

        if (deprecated) {
            return {
                name: name,
                location: {
                    uri: textDocumentURI,
                    range: range
                },
                kind: kind,
                deprecated: true
            };
        }
        return {
            name: name,
            location: {
                uri: textDocumentURI,
                range: range
            },
            kind: kind
        };
    }

    // Traverses the tree and generates symbols
    // Optionally, can breach lists where inner-list symbols are not referable from the outside
    // world
    public* traverseSymbolTree(tree: TreeParser.Tree, textDocument: TextDocumentIdentifier, onlyReferable: boolean) {
            let cursor = tree.walk();
            let reached_root = false;
            while (reached_root == false) 
            {
                let names : string[];
                let node = cursor.currentNode;
                // Capture keyword parents, including lists
                if (node.type == 'key_value'){
                    let names :string[] = [node.namedChild(0).text];
                    let parent = node.parent;
                    while (parent != tree.rootNode && parent != null){
                        if (parent.type == 'list') {
                            if (onlyReferable) {
                                // Skip what's inside the list if only referable 
                                // symbols are requested; e.g. for use as macros
                                if (cursor.gotoFirstChild()) continue;
                                if (cursor.gotoNextSibling()) continue;
                                break;
                            }
                            names.unshift(parent.firstNamedChild.text)
                            parent = parent.parent
                            names.unshift(parent.firstNamedChild.text)
                        }
                        if (parent.type == 'dict') {
                            names.unshift(parent.firstNamedChild.text)
                        }
                        parent = parent.parent;
                    }

                    // Take a look at what kind of value this key_value has
                    // and do basic token type recognition
                    let symbolType : SymbolKind;// = SymbolKind.Variable;

                    if (node.namedChildren.length >= 2) {
                        if (node.namedChildren[1].type == 'list') {
                            symbolType = SymbolKind.Array;
                        } else if (node.namedChildren[1].type == 'macro') {
                            symbolType = SymbolKind.Constant;
                        } else if (node.namedChildren[1].type == 'code') {
                            symbolType = SymbolKind.Module;
                        } else if (node.namedChildren[1].type == 'number_literal') {
                            symbolType = SymbolKind.Number;
                        } else if (node.namedChildren[1].type == 'string_literal') {
                            symbolType = SymbolKind.String;
                        } else if (node.namedChildren[1].type == 'identifier'
                            && ["on", "off", "true", "false", "yes", "no"].indexOf(node.namedChild(1).text) > -1
                        ) {
                            symbolType = SymbolKind.Boolean;
                        } else {
                            symbolType = SymbolKind.Key;
                        }

                        yield this.createSymbolInformation(
                            names.join('.'),
                            textDocument.uri,
                            Range.create(
                                node.namedChildren[1].startPosition.row,
                                node.namedChildren[1].startPosition.column,
                                node.namedChildren[1].endPosition.row,
                                node.namedChildren[1].endPosition.column
                            ),
                            symbolType, false
                        );
                    } else {
                        if (node.namedChildren[0].type == 'list') {
                            symbolType = SymbolKind.Array;
                        } else if (node.namedChildren[0].type == 'macro') {
                            symbolType = SymbolKind.Constant;
                        } else if (node.namedChildren[0].type == 'code') {
                            symbolType = SymbolKind.Module;
                        } else if (node.namedChildren[0].type == 'number_literal') {
                            symbolType = SymbolKind.Number;
                        } else if (node.namedChildren[0].type == 'string_literal') {
                            symbolType = SymbolKind.String;
                        } else if (node.namedChildren[0].type == 'boolean')
                        {
                            symbolType = SymbolKind.Boolean;
                        } else {
                            symbolType = SymbolKind.Key;
                        }

                        yield this.createSymbolInformation(
                            names.join('.'),
                            textDocument.uri,
                            Range.create(
                                node.namedChildren[0].startPosition.row,
                                node.namedChildren[0].startPosition.column,
                                node.namedChildren[0].endPosition.row,
                                node.namedChildren[0].endPosition.column
                            ),
                            symbolType, false
                        );
                    }

                }

                // Capture dict parents
                if (node.type == 'dict'){
                    let names :string[] = [node.namedChildren[0].text];
                    let parent = node.parent;
                    while (parent != tree.rootNode && parent != null){
                        if (parent.type == 'dict') {
                            names.unshift(parent.firstNamedChild.text)
                        }
                        parent = parent.parent;
                    }
                    yield this.createSymbolInformation(
                        names.join('.'),
                        textDocument.uri,
                        Range.create(
                            node.startPosition.row,
                            node.startPosition.column,
                            node.endPosition.row,
                            node.endPosition.column
                        ),
                        SymbolKind.Struct, false
                    );
                }

                if (cursor.gotoFirstChild()) continue;
                if (cursor.gotoNextSibling()) continue;

                let retracing = true;
                while (retracing)
                {
                    if (cursor.gotoParent() == false){
                        retracing = false;
                        reached_root = true;
                    }

                    if (cursor.gotoNextSibling()) {
                        retracing = false;
                    }
                }
            }
    }

    // Returns all symbols from a document (breaching lists)
    public parseSymbolInformation(textDocument: TextDocumentIdentifier, content: string): SymbolInformation[] {

        let symbols: SymbolInformation[] = [];
        const tree = this.treeParser.parse(content);
        for (let entry of this.traverseSymbolTree(tree, textDocument, false)) {
            symbols.push( entry );
        }
        return symbols;
    }
}
