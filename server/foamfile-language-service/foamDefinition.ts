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
import { FoamWorkspaceIndex } from './foamWorkspaceIndex';
import { FoamCase, nodeAtPosition, nodeRange, findDictPath, parseMacro } from './foamCase';
import * as TreeParser from 'tree-sitter';

export class FoamDefinition {

    // A local reference to the Tree-Sitter Parser
    private treeParser : TreeParser;
    private index: FoamWorkspaceIndex | null;

    // Constructor
    constructor(parser : TreeParser, index?: FoamWorkspaceIndex) {
        this.treeParser = parser;
        this.index = index ?? null;
    }

    // Keyword definitions don't need ranges
    // Here for futur considerations
    // TODO: Use Tree-Sitter to get definition node ranges
    public computeDefinitionRange(content: string, position: Position): Range | null {
        return null;
    }

    // Returns the macro node at current position 
    public getMacroNodeUnderCursor(content: string, position: Position, parsedTree?: TreeParser.Tree) {
        let document : TextDocument = TextDocument.create("", "foam", 0, content);
        let offset = document.offsetAt(position)
        const tree = parsedTree ?? this.treeParser.parse(content);

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
    public getNodeDefinition(node: TreeParser.SyntaxNode, content: string, parsedTree?: TreeParser.Tree) : TreeParser.SyntaxNode | null {

        // Return the same node if not a macro-like
        if (!node.text.startsWith('$')) { return node; }

        let document : TextDocument = TextDocument.create("", "foam", 0, content);
        const tree = parsedTree ?? this.treeParser.parse(content);
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

    // nearest enclosing dict scope of a node, up to the file root
    private enclosingScope(node: TreeParser.SyntaxNode, tree: TreeParser.Tree): TreeParser.SyntaxNode {
        let walker = node.parent;
        while (walker && walker !== tree.rootNode) {
            if (walker.type === 'dict' || walker.type === 'dict_headless') {
                return walker;
            }
            walker = walker.parent;
        }
        return tree.rootNode;
    }

    // Resolve a macro to the location of the key it expands
    public resolveMacroDefinition(uri: string, tree: TreeParser.Tree, macroNode: TreeParser.SyntaxNode): Location | null {
        const parsed = parseMacro(macroNode.text);
        if (!parsed) {
            return null;
        }
        const crossFileUris = this.index
            ? [...this.index.includeClosure(uri), ...this.index.includedBy(uri)]
            : [];
        if (parsed.absolute) {
            const local = findDictPath(tree.rootNode, parsed.segments);
            if (local) {
                return Location.create(uri, nodeRange(local));
            }
            for (const u of crossFileUris) {
                const file = this.index.getFile(u);
                const target = file && findDictPath(file.tree.rootNode, parsed.segments);
                if (target) {
                    return Location.create(u, nodeRange(target));
                }
            }
            return null;
        }
        if (parsed.dots > 0) {
            // $.a = current dict, $..a = parent dict, one level per extra dot
            let scope = this.enclosingScope(macroNode, tree);
            for (let i = 1; i < parsed.dots && scope !== tree.rootNode; i++) {
                scope = this.enclosingScope(scope, tree);
            }
            const target = findDictPath(scope, parsed.segments);
            return target ? Location.create(uri, nodeRange(target)) : null;
        }
        // scoped lookup: enclosing dicts inside-out, then across files
        let scope = this.enclosingScope(macroNode, tree);
        while (true) {
            const target = findDictPath(scope, parsed.segments);
            if (target && target.startIndex !== macroNode.startIndex) {
                return Location.create(uri, nodeRange(target));
            }
            if (scope === tree.rootNode) {
                break;
            }
            scope = this.enclosingScope(scope, tree);
        }
        for (const u of crossFileUris) {
            const file = this.index.getFile(u);
            const target = file && findDictPath(file.tree.rootNode, parsed.segments);
            if (target) {
                return Location.create(u, nodeRange(target));
            }
        }
        return null;
    }

    // Computes where the definition of the symbol under the cursor is:
    // macro expansions (absolute, relative and scoped, cross-file through
    // includes), #include paths, boundary patch declarations
    public computeDefinition(textDocument: TextDocumentIdentifier, content: string, position: Position, parsedTree?: TreeParser.Tree): Location | null {
        const tree = parsedTree ?? this.treeParser.parse(content);
        const currentPosition = Location.create(textDocument.uri, Range.create(
            position.line, position.character, position.line, position.character));
        const node = nodeAtPosition(tree, position.line, position.character);
        if (!node) {
            return currentPosition;
        }
        const foamCase = new FoamCase(this.index);
        const target = foamCase.classifyPosition(textDocument.uri, node);
        if (!target) {
            return currentPosition;
        }
        if (target.kind === 'macro') {
            return this.resolveMacroDefinition(textDocument.uri, tree, target.node) ?? currentPosition;
        }
        if (target.kind === 'include' && this.index) {
            for (const include of this.index.includesOf(textDocument.uri)) {
                if (include.targetUri
                    && include.range.start.line <= position.line && position.line <= include.range.end.line) {
                    return Location.create(include.targetUri, Range.create(0, 0, 0, 0));
                }
            }
            return currentPosition;
        }
        if (target.kind === 'patch' || target.kind === 'patchGroup') {
            const declaration = foamCase.findPatchDeclaration(target.name);
            if (declaration && !(declaration.uri === textDocument.uri
                    && declaration.range.start.line === position.line)) {
                return Location.create(declaration.uri, declaration.range);
            }
        }
        return currentPosition;
    }
}
