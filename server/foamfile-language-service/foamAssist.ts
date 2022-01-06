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
import { Util, KEYWORDS, DIRECTIVES, SNIPPETS } from './foam';
import { CompletionItemCapabilities } from './main';
import { FoamCompletion } from './foamCompletion';
import { FoamSymbols } from './foamSymbols';
import { resolve } from 'url';

import * as TreeParser from 'web-tree-sitter';

export class FoamAssist {

    private snippetSupport: boolean;
    private deprecatedSupport: boolean;
    private supportedTags: CompletionItemTag[];
    private document: TextDocument;
    private parser : TreeParser;
    private performBananaTrick : boolean;

    // Assist in proposing completion items
    constructor(document: TextDocument, completionItemCapabilities: CompletionItemCapabilities, parser : TreeParser) {
        this.document = document;
        this.deprecatedSupport = completionItemCapabilities && completionItemCapabilities.deprecatedSupport;
        this.snippetSupport = completionItemCapabilities && completionItemCapabilities.snippetSupport;
        this.supportedTags = completionItemCapabilities && completionItemCapabilities.tagSupport && completionItemCapabilities.tagSupport.valueSet;
        this.parser = parser;
        this.performBananaTrick = true;
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
        let content = document.getText().substring(Math.min(offset-50, 0), offset);
        let tokens = content.split(/\s|\n|\r/);
        return tokens[tokens.length-1];
    }
    
    private getLineAtPosition(document: TextDocument, position: Position): string {
        let offset = this.document.offsetAt(position);
        let content = document.getText().substring(Math.min(offset-50, 0), offset);
        let tokens = content.split(/\n|\r/);
        return tokens[tokens.length-1];
    }
    
    public computeProposals(position: Position): CompletionItem[] | PromiseLike<CompletionItem[]> {
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

        // I. Value-based auto-completion

        // Macro expansion, suggests all possible variables in this dict
        // using Tree-Sitter symbol lookup
        if (word && word.startsWith('$')) {
            const tree = this.parser.parse(this.document.getText())
            for (let entry of foamSymbols.traverseSymbolTree(tree, {uri: this.document.uri}, false)) {
                proposals.push({
			    	label: entry.name,
			    	kind: CompletionItemKind.Variable,
                    insertText: ":"+entry.name
                });
            }
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
        }

        // Suggest keywords if line does not contain a space after a word
        const line = this.getLineAtPosition(this.document, position);
        if (line && line.match(/\S\s+\S?/) == null) {
            // The keyword part
            for (let entry of KEYWORDS) {
                if (entry.startsWith(word)) {
                    proposals.push({
		    	    	label: entry,
		    	    	kind: CompletionItemKind.Keyword,
		    	    	data: entry
                    });
                }
            }
        } else {
            // TODO: the value part, maybe the banana trick will go here 
        }

        // II. Snippets
        // TODO: Do native snippet suggestions on this.snippetSupport
        for (let entry of SNIPPETS) {
            proposals.push({
                label: entry.label,
                kind: CompletionItemKind.Snippet,
                data: entry.label,
                insertText: entry.content,
                insertTextFormat: InsertTextFormat.Snippet
            });
        }

        // III. Suggestions from banana trick
        // TODO: Use banana trick on solvers to get valid values for auto-completion
        // DISCUSSION: The OpenFOAM parser is not fault-tolerant enough
        // This may easily fail if user has an IO error already
        if (this.performBananaTrick)
        {
            // 0. Detect current Tree-Sitter node
            // 1. Replace the current keyword's value with banana;
            // 2. Attempt the solver
            // 3. Record a list of valid items

            // 4. Potentially Add one library to controlDict.libs
            // 5. Repeat 2-4 until no more libraries (skipping the )
            // 6. If user chooses something from a loaded library, warn them
            //    they should load the target library manually (Maybe a codeAction?)
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
