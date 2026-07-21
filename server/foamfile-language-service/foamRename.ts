/*
    Workspace-wide, OpenFOAM-aware symbol renaming.

    Renaming a boundary patch touches its declaration (polyMesh/boundary,
    blockMeshDict, createPatchDict), every field file's boundaryField entry,
    decomposeParDict patch lists and exact quoted alternations "(a|b)".
    Renaming a key also updates $macros referring to it.

    ponytail: edits are returned as a plain `changes` map (uri -> edits);
    versioned documentChanges if a client ever needs optimistic locking
*/
'use strict';

import { Position, Range, TextEdit, WorkspaceEdit, TextDocumentIdentifier } from 'vscode-languageserver-types';
import { FoamWorkspaceIndex } from './foamWorkspaceIndex';
import { FoamCase, nodeAtPosition, nodeRange, parseMacro } from './foamCase';
import { FoamReferences } from './foamReferences';
import * as TreeParser from 'tree-sitter';

// names must stay single tokens the dictionary syntax can digest
const VALID_NAME = /^[^\s\/;{}"'$#()\[\]]+$/;

export class FoamRename {

    private treeParser: TreeParser;
    private index: FoamWorkspaceIndex | null;

    constructor(parser?: TreeParser, index?: FoamWorkspaceIndex) {
        this.treeParser = parser;
        this.index = index ?? null;
    }

    public prepareRename(textDocument: TextDocumentIdentifier, content: string, position: Position, parsedTree?: TreeParser.Tree): Range | null {
        if (!this.treeParser) {
            return null;
        }
        const tree = parsedTree ?? this.treeParser.parse(content);
        const node = nodeAtPosition(tree, position.line, position.character);
        const foamCase = new FoamCase(this.index);
        const target = foamCase.classifyPosition(textDocument.uri, node);
        if (!target) {
            return null;
        }
        if (target.kind === 'include') {
            return null;
        }
        // quoted keys are renameable only when they are exact alternations
        if (target.node.type === 'string_literal'
            && foamCase.alternationMembers(target.node.text).length === 0) {
            return null;
        }
        if (target.kind === 'macro') {
            // rename the identifier part, not the $ sigil
            const identifier = target.node.namedChildren.find(c => c.type === 'identifier');
            return identifier ? nodeRange(identifier) : null;
        }
        return nodeRange(target.node);
    }

    public rename(textDocument: TextDocumentIdentifier, content: string, position: Position, newName: string, parsedTree?: TreeParser.Tree): WorkspaceEdit | null {
        if (!this.treeParser || !VALID_NAME.test(newName)) {
            return null;
        }
        const tree = parsedTree ?? this.treeParser.parse(content);
        const node = nodeAtPosition(tree, position.line, position.character);
        const foamCase = new FoamCase(this.index);
        const target = foamCase.classifyPosition(textDocument.uri, node);
        if (!target || target.kind === 'include') {
            return null;
        }

        const changes: { [uri: string]: TextEdit[] } = {};
        const addEdit = (uri: string, range: Range, text: string) => {
            (changes[uri] = changes[uri] ?? []).push(TextEdit.replace(range, text));
        };

        if (target.kind === 'patch' || target.kind === 'patchGroup') {
            const sites = target.kind === 'patch'
                ? foamCase.findPatchSites(target.name)
                : foamCase.findGroupSites(target.name);
            for (const site of sites) {
                if (site.quoted) {
                    const file = this.index?.getFile(site.uri);
                    const original = file
                        ? file.content.split('\n')[site.range.start.line]
                            .slice(site.range.start.character, site.range.end.character)
                        : null;
                    if (original) {
                        addEdit(site.uri, site.range, foamCase.rewriteAlternation(original, target.name, newName));
                    }
                } else {
                    addEdit(site.uri, site.range, newName);
                }
            }
        } else {
            // keys and macros: definition + macro usages, scoped to this file,
            // its includes and its includers
            const references = new FoamReferences(this.treeParser, this.index)
                .computeReferences(textDocument, content, position, tree);
            const targetName = target.kind === 'macro'
                ? parseMacro(target.node.text)?.segments.slice(-1)[0]
                : target.name;
            if (!targetName) {
                return null;
            }
            for (const loc of references) {
                const locTree = loc.uri === textDocument.uri
                    ? tree
                    : this.index?.getFile(loc.uri)?.tree;
                if (!locTree) {
                    continue;
                }
                const refNode = nodeAtPosition(locTree, loc.range.start.line, loc.range.start.character);
                if (refNode.type === 'macro' || refNode.parent?.type === 'macro') {
                    // rewrite only the final segment of the macro path
                    const macroNode = refNode.type === 'macro' ? refNode : refNode.parent;
                    const newText = macroNode.text.replace(new RegExp(`(^|[.:!$])${targetName}$`), `$1${newName}`);
                    addEdit(loc.uri, nodeRange(macroNode), newText);
                } else {
                    addEdit(loc.uri, loc.range, newName);
                }
            }
        }

        if (Object.keys(changes).length === 0) {
            return null;
        }
        return { changes };
    }
}
