/* --------------------------------------------------------------------------------------------
 * Copyright (c) Remy Suen. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
    Position, CompletionItem, Range, CodeActionContext, Command, TextDocumentIdentifier, Location, DocumentHighlight, SymbolInformation, SignatureHelp, TextEdit, DocumentLink, Hover, FormattingOptions, Diagnostic, MarkupKind, FoldingRange, CompletionItemTag, SemanticTokens
} from 'vscode-languageserver-types';
import { ValidatorSettings } from '../foamfile-utils/main';
import { LanguageService } from './languageService';
import * as TreeParser from 'tree-sitter'

/**
 * An interface for logging errors encountered in the language service.
 */
export interface ILogger {

    log(message: string): void;
}

export enum CommandIds {
    FATAL_ERROR = "FOAM FATAL ERROR",
    FATAL_IO_ERROR = "FOAM FATAL IO ERROR",
}

export namespace FoamLanguageServiceFactory {
    export function createLanguageService(): FoamLanguageService {
        return new LanguageService();
    }
}

export interface CompletionItemCapabilities {
    /**
     * Indicates whether completion items for deprecated
     * entries should be explicitly flagged in the item.
     */
    deprecatedSupport?: boolean;
    /**
     * Describes the supported content types that can be used
     * for a CompletionItem's documentation field.
     */
    documentationFormat?: MarkupKind[];
    /**
     * Indicates whether the snippet syntax should be used in
     * returned completion items.
     */
    snippetSupport?: boolean;
    /**
     * Indicates that the client editor supports tags in CompletionItems.
     */
    tagSupport?: {
        /**
         * Describes the set of tags that the editor supports.
         */
        valueSet: CompletionItemTag[];
    }
}

export interface CompletionCapabilities {
    /**
     * Capabilities related to completion items.
     */
    completionItem?: CompletionItemCapabilities;
}

export interface Capabilities {
    /**
     * Capabilities related to completion requests.
     */
    completion?: CompletionCapabilities;
    /**
     * Capabilities related to folding range requests.
     */
    foldingRange?: {
        /**
         * If set, the service may choose to return ranges that have
         * a bogus `startCharacter` and/or `endCharacter` and/or to
         * leave them as undefined.
         */
        lineFoldingOnly?: boolean;
        /**
         * The maximum number of folding ranges to return. This is a
         * hint and the service may choose to ignore this limit.
         */
        rangeLimit?: number;
    };
    /**
     * Capabilities related to hover requests.
     */
    hover?: {
        /**
         * Describes the content type that should be returned for hovers.
         */
        contentFormat?: MarkupKind[];
    }
}
export interface FormatterSettings extends FormattingOptions {

    /**
     * Flag to indicate that instructions that span multiple lines
     * should be ignored.
     */
    ignoreMultilineInstructions?: boolean;
}

export interface FoamLanguageService {

    setCapabilities(capabilities: Capabilities);

    computeCodeActions(textDocument: TextDocumentIdentifier, range: Range, context: CodeActionContext): Command[];

    computeCommandEdits(content: string, command: string, args: any[]): TextEdit[];

    computeCompletionItems(content: string, position: Position): CompletionItem[] | PromiseLike<CompletionItem[]>;

    resolveCompletionItem(item: CompletionItem): CompletionItem;

    computeDefinition(textDocument: TextDocumentIdentifier, content: string, position: Position): Location;

    computeFoldingRanges(content: string): FoldingRange[];

    computeHighlightRanges(content: string, position: Position): DocumentHighlight[];

    computeHover(content: string, position: Position): Hover | null;

    computeSymbols(textDocument: TextDocumentIdentifier, content: string): SymbolInformation[];

    computeSignatureHelp(content: string, position: Position): SignatureHelp;

    computeRename(textDocument: TextDocumentIdentifier, content: string, position: Position, newName: string): TextEdit[];

    prepareRename(content: string, position: Position): Range | null;

    computeLinks(content: string): DocumentLink[];

    resolveLink(link: DocumentLink): DocumentLink;

    /**
     * Experimental API subject to change.
     */
    computeSemanticTokens(content: string): SemanticTokens;

    validate(content: string, settings?: ValidatorSettings): Diagnostic[];

    //format(content: string, settings: FormatterSettings): TextEdit[];

    //formatRange(content: string, range: Range, settings: FormatterSettings): TextEdit[];

    //formatOnType(content: string, position: Position, ch: string, settings: FormatterSettings): TextEdit[];

    setLogger(logger: ILogger): void;
    setTreeParser(): void;
}
