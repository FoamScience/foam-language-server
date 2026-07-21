/*
    Find-all-references (and document highlight) for OpenFOAM cases:
    boundary patches, patch groups, macros and plain dictionary keys.
*/
'use strict';

import { Location, Position, Range, DocumentHighlight, DocumentHighlightKind, TextDocumentIdentifier } from 'vscode-languageserver-types';
import { FoamWorkspaceIndex } from './foamWorkspaceIndex';
import { FoamCase, nodeAtPosition, nodeRange, parseMacro } from './foamCase';
import * as TreeParser from 'tree-sitter';

export class FoamReferences {

    private treeParser: TreeParser;
    private index: FoamWorkspaceIndex | null;

    constructor(parser: TreeParser, index: FoamWorkspaceIndex | null) {
        this.treeParser = parser;
        this.index = index;
    }

    public computeReferences(textDocument: TextDocumentIdentifier, content: string, position: Position, parsedTree?: TreeParser.Tree): Location[] {
        const tree = parsedTree ?? this.treeParser.parse(content);
        const node = nodeAtPosition(tree, position.line, position.character);
        const foamCase = new FoamCase(this.index);
        const target = foamCase.classifyPosition(textDocument.uri, node);
        if (!target) {
            return [];
        }
        switch (target.kind) {
            case 'patch':
                return foamCase.findPatchSites(target.name)
                    .map(site => Location.create(site.uri, site.range));
            case 'patchGroup':
                return foamCase.findGroupSites(target.name)
                    .map(site => Location.create(site.uri, site.range));
            case 'macro':
                return this.macroReferences(textDocument.uri, tree, target.node);
            case 'key':
                return this.keyReferences(textDocument.uri, tree, target.node);
            default:
                return [];
        }
    }

    // Same-file references as highlights: keys/declarations write, uses read
    public computeHighlights(textDocument: TextDocumentIdentifier, content: string, position: Position, parsedTree?: TreeParser.Tree): DocumentHighlight[] {
        const tree = parsedTree ?? this.treeParser.parse(content);
        const node = nodeAtPosition(tree, position.line, position.character);
        const foamCase = new FoamCase(this.index);
        const target = foamCase.classifyPosition(textDocument.uri, node);
        if (target) {
            const references = this.computeReferences(textDocument, content, position, tree)
                .filter(loc => loc.uri === textDocument.uri);
            if (references.length > 0) {
                return references.map(loc => DocumentHighlight.create(loc.range,
                    this.isWriteRange(tree, loc.range) ? DocumentHighlightKind.Write : DocumentHighlightKind.Read));
            }
        }
        // fallback: same-text identifier occurrences in this document
        if (node && (node.type === 'identifier' || node.type === 'string_literal')) {
            return this.sameTextOccurrences(tree, node);
        }
        return [];
    }

    private isWriteRange(tree: TreeParser.Tree, range: Range): boolean {
        const node = nodeAtPosition(tree, range.start.line, range.start.character);
        const parent = node?.parent;
        if (!parent) {
            return false;
        }
        return (parent.type === 'key_value' || parent.type === 'dict' || parent.type === 'dict_headless')
            && parent.firstNamedChild?.startIndex === node.startIndex;
    }

    private sameTextOccurrences(tree: TreeParser.Tree, node: TreeParser.SyntaxNode): DocumentHighlight[] {
        const highlights: DocumentHighlight[] = [];
        for (const other of tree.rootNode.descendantsOfType(node.type)) {
            if (other.text === node.text) {
                highlights.push(DocumentHighlight.create(nodeRange(other),
                    other.parent && other.parent.firstNamedChild?.startIndex === other.startIndex
                        ? DocumentHighlightKind.Write
                        : DocumentHighlightKind.Read));
            }
        }
        return highlights;
    }

    /* ---------------- macros and keys ---------------- */

    // uris worth scanning for macro/key references: this file, everything
    // it includes, and everything that includes it
    private scanScope(uri: string, tree: TreeParser.Tree): { uri: string, tree: TreeParser.Tree }[] {
        const scope = [{ uri, tree }];
        if (this.index) {
            const seen = new Set([uri]);
            for (const u of [...this.index.includeClosure(uri), ...this.index.includedBy(uri)]) {
                if (!seen.has(u)) {
                    seen.add(u);
                    const file = this.index.getFile(u);
                    if (file) {
                        scope.push({ uri: u, tree: file.tree });
                    }
                }
            }
        }
        return scope;
    }

    // References of a macro: its definition plus every macro usage with the
    // same final name (matching by last path segment keeps scoped/relative
    // variants together)
    private macroReferences(uri: string, tree: TreeParser.Tree, macroNode: TreeParser.SyntaxNode): Location[] {
        const parsed = parseMacro(macroNode.text);
        if (!parsed) {
            return [];
        }
        const lastSegment = parsed.segments[parsed.segments.length - 1];
        const locations: Location[] = [];
        for (const { uri: u, tree: t } of this.scanScope(uri, tree)) {
            // usages
            for (const macro of t.rootNode.descendantsOfType('macro')) {
                const p = parseMacro(macro.text);
                if (p && p.segments[p.segments.length - 1] === lastSegment) {
                    locations.push(Location.create(u, nodeRange(macro)));
                }
            }
            // definitions: key_values whose key is the macro's target name
            for (const kv of t.rootNode.descendantsOfType('key_value')) {
                const key = kv.namedChild(0);
                if (key && key.text === lastSegment) {
                    locations.push(Location.create(u, nodeRange(key)));
                }
            }
        }
        return locations;
    }

    // References of a plain key: its definition(s) and macros pointing at it
    private keyReferences(uri: string, tree: TreeParser.Tree, keyNode: TreeParser.SyntaxNode): Location[] {
        const name = keyNode.text;
        const locations: Location[] = [];
        for (const { uri: u, tree: t } of this.scanScope(uri, tree)) {
            for (const kv of t.rootNode.descendantsOfType('key_value')) {
                const key = kv.namedChild(0);
                if (key && key.text === name) {
                    locations.push(Location.create(u, nodeRange(key)));
                }
            }
            for (const dict of t.rootNode.descendantsOfType('dict')) {
                if (dict.firstNamedChild?.text === name) {
                    locations.push(Location.create(u, nodeRange(dict.firstNamedChild)));
                }
            }
            for (const macro of t.rootNode.descendantsOfType('macro')) {
                const p = parseMacro(macro.text);
                if (p && p.segments[p.segments.length - 1] === name) {
                    locations.push(Location.create(u, nodeRange(macro)));
                }
            }
        }
        return locations;
    }
}
