/*
    Jump-to-Definition behaviour for macros in OpenFOAM dictionaries
    Author: Mohammed Elwardi Fadeli
    PS: We're doing this without the help of the native OpenFOAM parser
        Just using Tree-Sitter grammar to match reference nodes

    Current Status:
    - Macros featuring "absolute paths to keywords"

    Possible Improvements:
    - Support relative macro expansion notation
*/
'use strict';

import { TextDocument, Position, Range, Location, TextDocumentIdentifier } from 'vscode-languageserver-types';
import * as TreeParser from 'tree-sitter';

export class FoamDefinition {

    // A local reference to the Tree-Sitter Parser
    private treeParser : TreeParser;

    // Constructor
    constructor(parser : TreeParser) {
        this.treeParser = parser;
    }

    // Keyword definitions don't need ranges
    // Here for futur considerations
    // TODO: Use Tree-Sitter to get definition node ranges
    public computeDefinitionRange(content: string, position: Position): Range | null {
        return null;
    }

    // Returns the macro node at current position 
    public getMacroNodeUnderCursor(content: string, position: Position) {
        let document : TextDocument = TextDocument.create("", "foam", 0, content);
        let offset = document.offsetAt(position)
        const tree = this.treeParser.parse(content);

        // Start from root
        let root = tree.rootNode;
        let closestNode = root;
        let nodeNotFound = true;
        while (nodeNotFound) {
            for (let child of root.children) {
                if (
                    (Math.abs(offset - child.startIndex) <= Math.abs(offset - closestNode.startIndex))
                    && (offset >= child.startIndex)
                )
                {
                    closestNode = child;
                }
            }
            if (root == closestNode)
            {
                nodeNotFound = false;
            }
            root = closestNode;
        }
        while(root != null && root.type != "macro" && root != tree.rootNode) {
            root = root.parent
        }
        if (root.type == "macro") {
            return root;
        } else {
            return null;
        }
    }

    // Return the node which defines the content of passed node
    // "node" is assumed to be an indentifier under a macro
    // i.e. its text starts with "$"
    // Returns null if current node is not a macro node
    public getNodeDefinition(node: TreeParser.SyntaxNode, content: string) : TreeParser.SyntaxNode | null {

        // Return the same node if not a macro-like
        if (!node.text.startsWith('$')) { return node; }

        let document : TextDocument = TextDocument.create("", "foam", 0, content);
        const tree = this.treeParser.parse(content);
        let cursor = tree.walk();

        // TODO: Support relative macro expansion in jump to definitions
        // TODO: Maybe switch to ":" separator
        // Plan:
        // - Each . at the start of macro identifier will
        //   retrace parents until finding a dict 
        // Issues:
        // - Tree-Sitter walk does not like parent retracing
        let nodeParents = node == null ? [] : node.text.replace('$:', '').split('.');

        // This parameter denotes how much of node parents we've found
        let prec = 0;

        // If this is the root node (hopefully), enter the tree
        if (cursor.currentNode != null && cursor.currentNode.type == "foam") {
            cursor.gotoFirstChild();
        }

        // Find all dictionaries down to the last dictionary level just before
        // the matching keyword
        while (node != null && prec != nodeParents.length-1) {
            node = cursor.currentNode;
            // If this is a dict matching a requested parent
            if (node.type == "dict" && node.namedChild(0).text == nodeParents[prec])
            {
                prec += 1;
                if (cursor.gotoFirstChild()) continue;
            } else {
                if (cursor.gotoNextSibling()) continue;
            }

        }

        // Find the matching key-value pair
        while (node != null && prec != nodeParents.length) {
            node = cursor.currentNode;
            // If it's a dict_core, skip to the its content
            if (node.type == "dict_core") {
                if (cursor.gotoFirstChild()) continue;
            }
            // If a matching keyword is caught
            if (node.type == "key_value" && node.namedChild(0).text == nodeParents[nodeParents.length-1])
            {
                prec += 1;
            } else {
                if (cursor.gotoNextSibling()) continue;
            }
        }
        return cursor.currentNode.namedChild(1);
    }

    // Computes where the definition of a keyword is
    // - "Definition" for now means macro expansion
    public computeDefinition(textDocument: TextDocumentIdentifier, content: string, position: Position): Location | null {
        let currentMacroNode = this.getMacroNodeUnderCursor(content, position);
        if (currentMacroNode == null) {
            return Location.create(textDocument.uri, Range.create(
                position.line,
                position.character,
                position.line,
                position.character));
        }
        let definitionNode = this.getNodeDefinition(currentMacroNode, content);
        let range = Range.create(
            definitionNode.startPosition.row,
            definitionNode.startPosition.column,
            definitionNode.endPosition.row,
            definitionNode.endPosition.column,
        );

        return Location.create(textDocument.uri, range)
    }
}
