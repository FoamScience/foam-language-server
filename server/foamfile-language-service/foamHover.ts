/*
    Hover information for OpenFOAM keywords
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Support for hovering over keywords
    - Index-aware hover for patches, patch groups and macros

    Possible Improvements:
    - Support online links to keywords
*/
'use strict';

import { TextDocument, Hover, Position, MarkupKind } from 'vscode-languageserver-types';
import { MarkdownDocumentation } from './foamMarkdown';
import { PlainTextDocumentation } from './foamPlainText';
import { FoamWorkspaceIndex } from './foamWorkspaceIndex';
import { FoamCase, nodeAtPosition } from './foamCase';
import { FoamDefinition } from './foamDefinition';

import * as TreeParser from 'tree-sitter';
const path = require('path');

export class FoamHover {

    // A local reference to the Tree-Sitter Parser
    private treeParser : TreeParser;
    private markdown: MarkdownDocumentation;
    private plainText: PlainTextDocumentation;
    private index: FoamWorkspaceIndex | null;

    constructor(markdown: MarkdownDocumentation, plainText: PlainTextDocumentation, parser: TreeParser, index?: FoamWorkspaceIndex | null) {
        this.treeParser = parser;
        this.markdown = markdown;
        this.plainText = plainText;
        this.index = index ?? null;
    }

    // Returns the node at current position
    public getNodeUnderCursor(content: string, position: Position, parsedTree?: TreeParser.Tree) {
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
        return root;
    }

    // What happens the hover event is triggered
    public onHover(content: string, position: Position, markupKind: MarkupKind[], parsedTree?: TreeParser.Tree, uri?: string): Hover | null {

        const tree = parsedTree ?? this.treeParser.parse(content);
        const node = this.getNodeUnderCursor(content, position, tree);
        const key = node.text;
        if (!key) {
            return null;
        }

        if (uri && this.index) {
            const richHover = this.computeIndexHover(uri, tree, node, markupKind);
            if (richHover) {
                return richHover;
            }
        }

        // if it's not a raw value, fetch documenation
        if (markupKind && markupKind.length > 0) {
            switch (markupKind[0]) {
                case MarkupKind.Markdown:
                    let markdownDocumentation = this.markdown.getMarkdown(key);
                    if (markdownDocumentation) {
                        return {
                            contents: {
                                kind: MarkupKind.Markdown,
                                value: markdownDocumentation.contents as string
                            }
                        };
                    }
                    return null;
                case MarkupKind.PlainText:
                    let plainTextDocumentation = this.plainText.getDocumentation(key);
                    if (plainTextDocumentation) {
                        return {
                            contents: {
                                kind: MarkupKind.PlainText,
                                value: plainTextDocumentation
                            }
                        };
                    }
            }
            return null;
        }
        const hover = this.markdown.getMarkdown(key);
        return hover === undefined ? null : hover;
    }

    // Patch / patch group / macro hover, backed by the workspace index.
    // Returns null when the node under the cursor isn't one of those (or
    // the target can't be resolved), so callers fall back to keyword docs.
    private computeIndexHover(uri: string, tree: TreeParser.Tree, node: TreeParser.SyntaxNode, markupKind: MarkupKind[]): Hover | null {
        const foamCase = new FoamCase(this.index);
        const target = foamCase.classifyPosition(uri, node);
        if (!target) {
            return null;
        }
        const plain = !!(markupKind && markupKind.length > 0 && markupKind[0] === MarkupKind.PlainText);
        switch (target.kind) {
            case 'patch':
                return this.patchHover(target.name, plain);
            case 'patchGroup':
                return this.groupHover(target.name, plain);
            case 'macro':
                return this.macroHover(uri, tree, target.node, plain);
        }
        return null;
    }

    private toHover(lines: string[], plain: boolean): Hover {
        return plain
            ? { contents: { kind: MarkupKind.PlainText, value: lines.join('\n') } }
            : { contents: { kind: MarkupKind.Markdown, value: lines.join('\n') } };
    }

    // type/nFaces/startFace of a patch, found by walking the dict body
    // that follows its declaration identifier (mirrors how
    // FoamWorkspaceIndex.extractPatches pairs identifier+dict_headless)
    private patchBody(nameNode: TreeParser.SyntaxNode): { type?: string, nFaces?: string, startFace?: string } {
        const body = nameNode?.nextNamedSibling;
        const result: { type?: string, nFaces?: string, startFace?: string } = {};
        if (!body || (body.type !== 'dict_headless' && body.type !== 'dict')) {
            return result;
        }
        for (const kv of body.descendantsOfType('key_value')) {
            const k = kv.namedChild(0)?.text;
            const v = kv.namedChild(1)?.text;
            if (!k || !v) {
                continue;
            }
            if (k === 'type') { result.type = v; }
            else if (k === 'nFaces') { result.nFaces = v; }
            else if (k === 'startFace') { result.startFace = v; }
        }
        return result;
    }

    private patchHover(name: string, plain: boolean): Hover | null {
        const foamCase = new FoamCase(this.index);
        const decl = foamCase.findPatchDeclaration(name);
        if (!decl) {
            return null;
        }
        const file = this.index.getFile(decl.uri);
        if (!file) {
            return null;
        }
        const relPath = file.relPath.split(path.sep).join('/');
        const nameNode = nodeAtPosition(file.tree, decl.range.start.line, decl.range.start.character);
        const { type, nFaces, startFace } = this.patchBody(nameNode);
        const groups = this.index.patchNames().get(name)?.groups ?? [];

        const lines: string[] = [plain ? `patch ${name}` : `**patch** \`${name}\``];
        if (type) {
            lines.push(`type: ${type}`);
        }
        if (nFaces && startFace) {
            lines.push(`nFaces: ${nFaces}, startFace: ${startFace}`);
        }
        if (groups.length > 0) {
            lines.push(`groups: ${groups.join(', ')}`);
        }
        lines.push(`declared in ${relPath}`);
        return this.toHover(lines, plain);
    }

    private groupHover(name: string, plain: boolean): Hover | null {
        const members: string[] = [];
        for (const [patchName, info] of this.index.patchNames()) {
            if (info.groups.includes(name)) {
                members.push(patchName);
            }
        }
        if (members.length === 0) {
            return null;
        }
        const lines = [
            plain ? `patch group ${name}` : `**patch group** \`${name}\``,
            `members: ${members.join(', ')}`
        ];
        return this.toHover(lines, plain);
    }

    private macroHover(uri: string, tree: TreeParser.Tree, macroNode: TreeParser.SyntaxNode, plain: boolean): Hover | null {
        const definition = new FoamDefinition(this.treeParser, this.index).resolveMacroDefinition(uri, tree, macroNode);
        if (!definition) {
            return null;
        }
        const file = this.index.getFile(definition.uri);
        if (!file) {
            return null;
        }
        const document = TextDocument.create("", "foam", 0, file.content);
        const value = file.content.slice(
            document.offsetAt(definition.range.start),
            document.offsetAt(definition.range.end));
        const relPath = file.relPath.split(path.sep).join('/');
        const line = plain
            ? `macro ${macroNode.text} = ${value} (from ${relPath})`
            : `**macro** \`${macroNode.text}\` = \`${value}\` (from ${relPath})`;
        return this.toHover([line], plain);
    }
}
