/*
    Easier completion items handling
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - No completion on ')' and '('
    - Keyword completion on ' ', or entering a '{}' block
    - Absolute macro expansion completion on '$'
    - Preprocessor directives completion on '#'

    Possible Improvements:
    - Add more keywords, preprocessor directives and their documentation
    - Support relative macro expansion completion
*/
'use strict';

import { InsertTextMode, MarkupKind } from 'vscode-languageserver';
import {
    TextDocument, TextEdit, Range, Position,
    CompletionItem, CompletionItemKind, CompletionItemTag, InsertTextFormat, TextDocumentIdentifier
} from 'vscode-languageserver-types';
import { Util, KEYWORDS, DIRECTIVES, SNIPPETS, KEYWORD_DB, KeywordEntry, keywordsFor, runtimeDoc } from './foam';
import { CompletionItemCapabilities } from './main';
import { FoamCompletion } from './foamCompletion';
import { FoamSymbols } from './foamSymbols';
import { FoamWorkspaceIndex } from './foamWorkspaceIndex';
import { nodeAtPosition, findDictPath } from './foamCase';

import * as TreeParser from 'tree-sitter';
const path = require('path');

export class FoamAssist {

    private snippetSupport: boolean;
    private deprecatedSupport: boolean;
    private supportedTags: CompletionItemTag[];
    private document: TextDocument;
    private parser : TreeParser;
    private index: FoamWorkspaceIndex | null;
    // valid values previously harvested from solver errors (passive banana trick)
    private solverOptions: string[];
    // active banana trick: kicks off a background probe for dictPath (last
    // segment is the keyword under completion); undefined when opted out
    private probeCallback?: (dictPath: string[]) => void;
    // active banana trick: dict path (joined with '/') -> options already
    // harvested for this uri
    private bananaOptions: Map<string, string[]>;

    // Assist in proposing completion items
    constructor(document: TextDocument, completionItemCapabilities: CompletionItemCapabilities, parser : TreeParser, index?: FoamWorkspaceIndex, solverOptions?: string[], probeCallback?: (dictPath: string[]) => void, bananaOptions?: Map<string, string[]>) {
        this.document = document;
        this.deprecatedSupport = completionItemCapabilities && completionItemCapabilities.deprecatedSupport;
        this.snippetSupport = completionItemCapabilities && completionItemCapabilities.snippetSupport;
        this.supportedTags = completionItemCapabilities && completionItemCapabilities.tagSupport && completionItemCapabilities.tagSupport.valueSet;
        this.parser = parser;
        this.index = index ?? null;
        this.solverOptions = solverOptions ?? [];
        this.probeCallback = probeCallback;
        this.bananaOptions = bananaOptions ?? new Map();
    }

    // A Text edit for a completion item
    // Always insert, no replacing
    // TODO: Maybe implement proper replace functionality
    private createTextEdit(offset: number, newText: string): TextEdit {
        return TextEdit.insert(this.document.positionAt(offset), newText);
    }

    // TODO: This kind of assumes keywords can't have white space, which is OK
    private getWordAtPosition(document: TextDocument, position: Position): string {
        let offset = this.document.offsetAt(position);
        let content = document.getText().substring(Math.max(offset-50, 0), offset);
        let tokens = content.split(/\s|\n|\r/);
        return tokens[tokens.length-1];
    }
    
    private getLineAtPosition(document: TextDocument, position: Position): string {
        let offset = this.document.offsetAt(position);
        let content = document.getText().substring(Math.max(offset-50, 0), offset);
        let tokens = content.split(/\n|\r/);
        return tokens[tokens.length-1];
    }
    
    // The FoamFile object name identifies which keyword set applies
    private objectNameOf(tree: TreeParser.Tree): string | undefined {
        const node = findDictPath(tree.rootNode, ['FoamFile', 'object']);
        if (node) {
            return node.text;
        }
        const uriPath = this.document.uri.replace(/^file:\/\//, '');
        return uriPath ? path.basename(uriPath) : undefined;
    }

    // Names of the dicts enclosing this position, innermost first
    private enclosingDictNames(tree: TreeParser.Tree, position: Position): string[] {
        const names: string[] = [];
        let node = nodeAtPosition(tree, position.line, position.character);
        while (node) {
            if ((node.type === 'dict' || node.type === 'dict_headless') && node.firstNamedChild) {
                names.push(node.firstNamedChild.text);
            }
            node = node.parent;
        }
        return names;
    }

    public computeProposals(position: Position, parsedTree?: TreeParser.Tree): CompletionItem[] | PromiseLike<CompletionItem[]> {
        let proposals: CompletionItem[] = [];
        let foamSymbols = new FoamSymbols(this.parser);

        // Get Word at current position
        let word = this.getWordAtPosition(
            this.document, position//Position.create(position.line, position.character + 1)
        );

        // Abort completion if the word starts with any of the following:
        if (word && (
            word.startsWith('(') ||
            word.startsWith(')')
        )) {
            return proposals;
        }

        const tree = parsedTree ?? this.parser.parse(this.document.getText());

        // I. Value-based auto-completion

        // Macro expansion, suggests all possible variables in this dict
        // (and, workspace-wide, referable symbols from the index)
        if (word && word.startsWith('$')) {
            const seen = new Set<string>();
            for (let entry of foamSymbols.traverseSymbolTree(tree, {uri: this.document.uri}, false)) {
                seen.add(entry.name);
                proposals.push({
			    	label: entry.name,
			    	kind: CompletionItemKind.Variable,
                    insertText: ":"+entry.name
                });
            }
            if (this.index) {
                for (const target of this.index.macroTargets()) {
                    if (!seen.has(target.name)) {
                        seen.add(target.name);
                        proposals.push({
                            label: target.name,
                            kind: CompletionItemKind.Variable,
                            detail: "workspace",
                            insertText: ":" + target.name
                        });
                    }
                }
            }
            return proposals;
        }

        // Preprocessor Directives:
        if (word && word.startsWith('#')) {
            for (let entry of DIRECTIVES) {
                    proposals.push({
		    	    	label: entry,
		    	    	kind: CompletionItemKind.Module,
		    	    	data: entry
                    });
            }
            return proposals;
        }

        const objectName = this.objectNameOf(tree);
        const dictNames = this.enclosingDictNames(tree, position);
        const inBoundaryField = dictNames.indexOf('boundaryField') > -1;

        // keyword set: file-wide (by FoamFile object), dict-context entries win
        let db: { [keyword: string]: KeywordEntry } = keywordsFor(objectName);
        for (const dictName of dictNames) {
            if (KEYWORD_DB[dictName]) {
                db = { ...db, ...KEYWORD_DB[dictName] };
            }
        }

        // Suggest keywords if line does not contain a space after a word
        const line = this.getLineAtPosition(this.document, position);
        if (line && line.match(/\S\s+\S?/) == null) {
            // The keyword part
            for (let entry of Object.keys(db)) {
                if (entry.startsWith(word)) {
                    proposals.push({
		    	    	label: entry,
		    	    	kind: CompletionItemKind.Keyword,
		    	    	data: entry
                    });
                }
            }
            // patch names double as sub-dict keys inside boundaryField
            if (inBoundaryField && this.index) {
                for (const [name] of this.index.patchNames()) {
                    if (name.startsWith(word)) {
                        proposals.push({
                            label: name,
                            kind: CompletionItemKind.Struct,
                            detail: "patch"
                        });
                    }
                }
            }
        } else {
            // The value part: valid values from the knowledge base and
            // "Valid options" lists harvested from earlier solver errors
            // (passive banana trick — no processes spawned from here)
            const keyContext = line ? line.trim().split(/\s+/)[0] : '';
            const entry = db[keyContext];
            if (entry && entry.values) {
                for (const value of entry.values) {
                    if (value.startsWith(word)) {
                        proposals.push({
                            label: value,
                            kind: CompletionItemKind.Value,
                            // resolve to the class docs when the value is a
                            // runtime-selectable name, else to keyword docs
                            data: runtimeDoc(value) ? value : keyContext
                        });
                    }
                }
            }
            // dict path (outermost first) + keyword, joined with '/' — same
            // key format the active banana trick's cache is keyed by, so a
            // keyword like "default" in ddtSchemes doesn't collide with the
            // same keyword in gradSchemes
            const dictPath = [...dictNames].reverse().concat([keyContext]);
            const pathKey = dictPath.join('/');
            const harvestedOptions = this.solverOptions.concat(
                (this.bananaOptions.get(pathKey) ?? []).filter(o => !this.solverOptions.includes(o))
            );
            for (const option of harvestedOptions) {
                if (option.startsWith(word) && !proposals.some(p => p.label === option)) {
                    proposals.push({
                        label: option,
                        kind: CompletionItemKind.Value,
                        detail: "from solver",
                        sortText: "0" + option,
                        // class docs on resolve (issue #15)
                        data: option
                    });
                }
            }

            // active banana trick: nothing known about this keyword's values
            // yet (no knowledge-base entry, nothing harvested so far) — kick
            // off a background probe. Fire-and-forget: the result lands in
            // the cache for the next completion request, this one doesn't wait.
            if (this.probeCallback && harvestedOptions.length === 0
                && (!entry || !entry.values || entry.values.length === 0)) {
                this.probeCallback(dictPath);
            }
        }

        // II. Snippets (static ones plus dict snippets from the knowledge base)
        for (let entry of SNIPPETS) {
            proposals.push({
                label: entry.label,
                kind: CompletionItemKind.Snippet,
                data: entry.label,
                insertText: entry.content,
                insertTextFormat: InsertTextFormat.Snippet
            });
        }
        for (const keyword of Object.keys(db)) {
            if (db[keyword].snippet) {
                proposals.push({
                    label: keyword + " { ... }",
                    kind: CompletionItemKind.Snippet,
                    data: keyword,
                    insertText: db[keyword].snippet,
                    insertTextFormat: InsertTextFormat.Snippet
                });
            }
        }

        return proposals;
    }

    // Create completion item for a keyword
    createKeywordCompletionItem(keyword: string, label: string, offset: number, insertText: string, markdown: string): CompletionItem {

        let textEdit = this.createTextEdit(offset, insertText);
        let item : CompletionItem = {
            data: markdown,
            textEdit: textEdit,
            label: label,
            kind: CompletionItemKind.Text,
            insertTextFormat: InsertTextFormat.PlainText,
        };
        let resolvedItem = new FoamCompletion().resolveCompletionItem(item, [MarkupKind.Markdown]);
        return resolvedItem;
    }
}
