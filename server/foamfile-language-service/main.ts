/* --------------------------------------------------------------------------------------------
 * Copyright (c) Remy Suen. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
    Position, CompletionItem, Range,
    CodeActionContext, Command, TextDocumentIdentifier,
    Location, DocumentHighlight, SymbolInformation,
    SignatureHelp, TextEdit, DocumentLink, Hover,
    FormattingOptions, Diagnostic, MarkupKind,
    FoldingRange, CompletionItemTag, SemanticTokens, WorkspaceEdit, InlayHint,
} from 'vscode-languageserver-types';
import { ValidatorSettings, SolverRunner } from '../foamfile-utils/main';
import { LanguageService } from './languageService';
import * as TreeParser from 'tree-sitter';

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

    /**
     * Capabilities related to workspace requests
     */
    workspace?: {
        /**
         * If set, the server may recieve requests for workspace/symbol
         */
        symbol?: boolean;
    }
}
export interface FoamLanguageService {

    setCapabilities(capabilities: Capabilities);

    computeCodeActions(textDocument: TextDocumentIdentifier, range: Range, context: CodeActionContext): Command[];

    computeCommandEdits(content: string, command: string, args: any[]): TextEdit[];

    computeCompletionItems(content: string, position: Position, tree?: TreeParser.Tree, uri?: string): CompletionItem[] | PromiseLike<CompletionItem[]>;

    resolveCompletionItem(item: CompletionItem): CompletionItem;

    computeDefinition(textDocument: TextDocumentIdentifier, content: string, position: Position, tree?: TreeParser.Tree): Location;

    computeFoldingRanges(content: string, tree?: TreeParser.Tree): FoldingRange[];

    computeSelectionRanges(content: string, positions: Position[], tree?: TreeParser.Tree): import('vscode-languageserver-types').SelectionRange[];

    computeHighlightRanges(textDocument: TextDocumentIdentifier, content: string, position: Position, tree?: TreeParser.Tree): DocumentHighlight[];

    computeReferences(textDocument: TextDocumentIdentifier, content: string, position: Position, tree?: TreeParser.Tree): Location[];

    computeHover(content: string, position: Position, tree?: TreeParser.Tree, uri?: string): Hover | null;

    computeSymbols(textDocument: TextDocumentIdentifier, content: string, tree?: TreeParser.Tree): SymbolInformation[];

    computeSignatureHelp(content: string, position: Position, tree?: TreeParser.Tree): SignatureHelp;

    computeRename(textDocument: TextDocumentIdentifier, content: string, position: Position, newName: string, tree?: TreeParser.Tree): WorkspaceEdit | null;

    prepareRename(textDocument: TextDocumentIdentifier, content: string, position: Position, tree?: TreeParser.Tree): Range | null;

    computeLinks(uri: string): DocumentLink[];

    resolveLink(link: DocumentLink): DocumentLink;

    /**
     * Experimental API subject to change.
     */
    computeSemanticTokens(content: string, uri?: string, tree?: TreeParser.Tree): SemanticTokens;

    computeSemanticTokensDelta(content: string, previousResultId: string | undefined, uri: string, tree?: TreeParser.Tree): SemanticTokens;

    clearSemanticTokensDelta(uri: string): void;

    computeInlayHints(content: string, range: Range, tree?: TreeParser.Tree): InlayHint[];

    validateWithSolver(uri: string, content: string, settings?: ValidatorSettings): Promise<[TextDocumentIdentifier[], Diagnostic[]]>;

    /**
     * Opts into the active banana trick (off by default). solverRunner is
     * test-only injection point for the solver process layer.
     */
    setBananaTrick(enabled: boolean, solverRunner?: SolverRunner): void;

    setLogger(logger: ILogger): void;
    setTreeParser(): Promise<void>;
    getTreeParser(): TreeParser;
    initializeWorkspace(rootUri: string): void;
    getWorkspaceIndex(): import('./foamWorkspaceIndex').FoamWorkspaceIndex | null;
}
