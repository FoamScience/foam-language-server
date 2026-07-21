#!/usr/bin/env node
/*
    Main language server initialization and control
*/
'use strict';

import * as fs from "fs";
import {
	createConnection, InitializeParams, InitializeResult, ClientCapabilities,
	TextDocuments,
	TextDocumentPositionParams, TextDocumentSyncKind, DocumentUri, TextEdit, Hover,
	CompletionItem, CodeActionParams, Command, ExecuteCommandParams,
	DocumentSymbolParams, WorkspaceSymbolParams, SymbolInformation, SignatureHelp,
	DocumentHighlight,
	RenameParams, Range, WorkspaceEdit, Location,
	DidChangeTextDocumentParams, DidOpenTextDocumentParams, DidCloseTextDocumentParams, TextDocumentContentChangeEvent,
	DidChangeConfigurationNotification, ConfigurationItem, DocumentLinkParams, DocumentLink, MarkupKind,
	VersionedTextDocumentIdentifier, TextDocumentEdit, CodeAction, CodeActionKind, ProposedFeatures,
	FoldingRangeParams, SemanticTokenModifiers, SemanticTokenTypes, SemanticTokensParams,
	Diagnostic, DocumentDiagnosticReportKind, TextDocumentIdentifier,
	DidChangeWatchedFilesNotification, FileChangeType, InlayHintParams
} from 'vscode-languageserver/node';
import { uriToFilePath } from 'vscode-languageserver/lib/node/files';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentCache } from './foamfile-language-service/documentCache';
import { SyntaxValidator } from './foamfile-utils/syntaxValidator';
import { ValidatorSettings, ValidationSeverity } from './foamfile-utils/main';
import { CommandIds, FoamLanguageServiceFactory } from './foamfile-language-service/main';

// The settings to use for the validator if the client doesn't support
// workspace/configuration requests.
let validatorSettings: ValidatorSettings | null = null;

// Validator params for an individual file retrieved via the workspace/configuration request.
let validatorConfigurations: Map<string, Thenable<ValidatorConfiguration>> = new Map();

// Create entry point
let connection = createConnection(ProposedFeatures.all);

// Create a service to drive the connection
let service = FoamLanguageServiceFactory.createLanguageService();
service.setLogger({
	log(message): void {
		connection.console.log(message);
	}
});

// Whether the client supports the workspace/applyEdit request.
let applyEditSupport: boolean = false;

// Whether the client supports the workspace/configuration request.
let configurationSupport: boolean = false;

// Whether the client supports the onChange request.
let documentChangesSupport: boolean = false;

// Whether the client supports the quickFix request.
let codeActionQuickFixSupport: boolean = false;

// Whether the client supports LSP 3.17 pull diagnostics
// (when it does, diagnostics are served on request instead of pushed)
let pullDiagnosticsSupport: boolean = false;

// Whether the client supports dynamic registration of file watchers
let watchedFilesSupport: boolean = false;

// Layered diagnostics per uri: instant tree-sitter syntax errors
// and solver-derived semantic errors, published merged
const syntaxValidator = new SyntaxValidator();
const diagnosticsState: Map<string, { syntax: Diagnostic[], solver: Diagnostic[] }> = new Map();

function diagnosticsFor(uri: string): { syntax: Diagnostic[], solver: Diagnostic[] } {
	let state = diagnosticsState.get(uri);
	if (!state) {
		state = { syntax: [], solver: [] };
		diagnosticsState.set(uri, state);
	}
	return state;
}

function mergedDiagnostics(uri: string): Diagnostic[] {
	const state = diagnosticsState.get(uri);
	return state ? state.syntax.concat(state.solver) : [];
}

function publishDiagnostics(uri: string): void {
	if (!pullDiagnosticsSupport) {
		connection.sendDiagnostics({ uri, diagnostics: mergedDiagnostics(uri) });
	}
}

// Per-document tree-sitter tree cache, created once the parser is ready
let documentCache: DocumentCache | null = null;

// Open documents, synced by the TextDocuments manager; tree.edit() bookkeeping
// happens in the update callback, against the pre-change document state
let documents = new TextDocuments<TextDocument>({
	create: (uri, languageId, version, content) => TextDocument.create(uri, languageId, version, content),
	update: (document, changes, version) => {
		if (documentCache) {
			documentCache.applyEdits(document, changes);
		}
		return TextDocument.update(document, changes, version);
	}
});

// Default project root, this must point to the OpenFOAM case
// This has to be the first "workspace folder"
let rootUri: DocumentUri | null = null;

// Retrieves a text document for the file located at the given URI string.
function getDocument(uri: string): PromiseLike<TextDocument> {
	const open = documents.get(uri);
	if (open) {
		return Promise.resolve(open);
	}
	return new Promise((resolve, _) => {
		let file = uriToFilePath(uri);
		if (file === undefined) {
			resolve(null);
		} else {
			fs.exists(file, (exists) => {
				if (exists) {
					fs.readFile(file, (err, data) => {
						resolve(TextDocument.create(uri, "foamfile", 1, data.toString()));
					});
				} else {
					resolve(null);
				}
			});
		}
	});
}

// Cached tree for a document (fresh parse for unopened files)
function getTree(document: TextDocument) {
	return documentCache ? documentCache.getTree(document.uri, document.getText()) : undefined;
}

function supportsDeprecatedItems(capabilities: ClientCapabilities): boolean {
	return capabilities.textDocument
		&& capabilities.textDocument.completion
		&& capabilities.textDocument.completion.completionItem
		&& capabilities.textDocument.completion.completionItem.deprecatedSupport;
}

function supportsSnippets(capabilities: ClientCapabilities): boolean {
	return capabilities.textDocument
		&& capabilities.textDocument.completion
		&& capabilities.textDocument.completion.completionItem
		&& capabilities.textDocument.completion.completionItem.snippetSupport;
}

function supportsCodeActionQuickFixes(capabilities: ClientCapabilities): boolean {
	let values = capabilities.textDocument
		&& capabilities.textDocument.codeAction
		&& capabilities.textDocument.codeAction.codeActionLiteralSupport
		&& capabilities.textDocument.codeAction.codeActionLiteralSupport.codeActionKind
		&& capabilities.textDocument.codeAction.codeActionLiteralSupport.codeActionKind.valueSet;
	if (values === null || values === undefined) {
		return false;
	}
	for (let value of values) {
		if (value === CodeActionKind.QuickFix) {
			return true;
		}
	}
	return false;
}

function getCompletionItemDocumentationFormat(capabilities: ClientCapabilities): MarkupKind[] | null | undefined {
	return capabilities.textDocument
		&& capabilities.textDocument.completion
		&& capabilities.textDocument.completion.completionItem
		&& capabilities.textDocument.completion.completionItem.documentationFormat;
}

function getHoverContentFormat(capabilities: ClientCapabilities): MarkupKind[] {
	return capabilities.textDocument
		&& capabilities.textDocument.hover
		&& capabilities.textDocument.hover.contentFormat;
}

function getLineFoldingOnly(capabilities: ClientCapabilities): boolean {
	return capabilities.textDocument
		&& capabilities.textDocument.foldingRange
		&& capabilities.textDocument.foldingRange.lineFoldingOnly;
}

function getRangeLimit(capabilities: ClientCapabilities): number {
	let rangeLimit = capabilities.textDocument
		&& capabilities.textDocument.foldingRange
		&& capabilities.textDocument.foldingRange.rangeLimit;
	if (rangeLimit === null || rangeLimit === undefined || typeof rangeLimit === "boolean" || isNaN(rangeLimit)) {
		rangeLimit = Number.MAX_VALUE;
	} else if (typeof rangeLimit !== "number") {
		// isNaN === false and not a number, must be a string number, convert it
		rangeLimit = Number(rangeLimit);
	}
	return rangeLimit;
}

function setServiceCapabilities(capabilities: ClientCapabilities): void {
	service.setCapabilities({
		completion: {
			completionItem: {
				deprecatedSupport: supportsDeprecatedItems(capabilities),
				documentationFormat: getCompletionItemDocumentationFormat(capabilities),
				snippetSupport: supportsSnippets(capabilities)
			}
		},
		hover: {
			contentFormat: getHoverContentFormat(capabilities)
		},
		foldingRange: {
			lineFoldingOnly: getLineFoldingOnly(capabilities),
			rangeLimit: getRangeLimit(capabilities)
		}
	});
}

connection.onInitialized(() => {
	if (configurationSupport) {
		// listen for notification changes if the client supports workspace/configuration
		connection.client.register(DidChangeConfigurationNotification.type);
		refreshCompletionConfiguration();
	}
	// index the whole case once the handshake is done
	if (rootUri) {
		setImmediate(() => service.initializeWorkspace(rootUri));
	}
	if (watchedFilesSupport) {
		connection.client.register(DidChangeWatchedFilesNotification.type, {
			watchers: [
				{ globPattern: '**/system/**' },
				{ globPattern: '**/constant/**' },
				{ globPattern: '**/0*/**' },
			]
		});
	}
});

connection.onDidChangeWatchedFiles((params) => {
	const index = service.getWorkspaceIndex();
	if (!index) {
		return;
	}
	for (const change of params.changes) {
		if (change.type === FileChangeType.Deleted) {
			index.remove(change.uri);
		} else {
			index.reindexUri(change.uri);
		}
	}
});

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
        await service.setTreeParser();
        documentCache = new DocumentCache(service.getTreeParser());
	    setServiceCapabilities(params.capabilities);
	    applyEditSupport = params.capabilities.workspace && params.capabilities.workspace.applyEdit === true;
	    documentChangesSupport = params.capabilities.workspace && params.capabilities.workspace.workspaceEdit && params.capabilities.workspace.workspaceEdit.documentChanges === true;
	    configurationSupport = params.capabilities.workspace && params.capabilities.workspace.configuration === true;
	    const renamePrepareSupport = params.capabilities.textDocument && params.capabilities.textDocument.rename && params.capabilities.textDocument.rename.prepareSupport === true;
	    const semanticTokensSupport = params.capabilities.textDocument && (params.capabilities.textDocument as any).semanticTokens;
	    const inlayHintSupport = !!(params.capabilities.textDocument?.inlayHint);
	    pullDiagnosticsSupport = !!(params.capabilities.textDocument && (params.capabilities.textDocument as any).diagnostic);
	    watchedFilesSupport = params.capabilities.workspace && params.capabilities.workspace.didChangeWatchedFiles && params.capabilities.workspace.didChangeWatchedFiles.dynamicRegistration === true;
	    codeActionQuickFixSupport = supportsCodeActionQuickFixes(params.capabilities);
        rootUri = params.workspaceFolders?.[0]?.uri ?? params.rootUri ?? null;
	    return {
	    	capabilities: {
	    		textDocumentSync: TextDocumentSyncKind.Incremental,
	    		diagnosticProvider: pullDiagnosticsSupport ? {
	    			interFileDependencies: true,
	    			workspaceDiagnostics: true
	    		} : undefined,
	    		codeActionProvider: applyEditSupport,
	    		completionProvider: {
	    			resolveProvider: true,
	    			triggerCharacters: [
	    				'$',
	    				'#',
	    			]
	    		},
	    		executeCommandProvider: applyEditSupport ? {
	    			commands: [
	    				CommandIds.FATAL_ERROR,
	    				CommandIds.FATAL_IO_ERROR,
	    			]
	    		} : undefined,
	    		hoverProvider: true,
	    		documentSymbolProvider: true,
	    		documentHighlightProvider: true,
	    		referencesProvider: true,
	    		renameProvider: renamePrepareSupport ? {
	    			prepareProvider: true
	    		} : true,
	    		definitionProvider: true,
	    		signatureHelpProvider: {
	    			triggerCharacters: [
	    				'-',
	    				'[',
	    				',',
	    				' ',
                        '{',
                        '\t',
	    				'=',
	    			]
	    		},
	    		documentLinkProvider: {
	    			resolveProvider: true
	    		},
	    		semanticTokensProvider: semanticTokensSupport ? {
	    			full: {
	    				delta: true
	    			},
	    			legend: {
	    				tokenTypes: [
	    					SemanticTokenTypes.keyword,
	    					SemanticTokenTypes.comment,
	    					SemanticTokenTypes.parameter,
	    					SemanticTokenTypes.property,
	    					SemanticTokenTypes.namespace,
	    					SemanticTokenTypes.class,
	    					SemanticTokenTypes.macro,
	    					SemanticTokenTypes.string,
	    					SemanticTokenTypes.variable,
	    					SemanticTokenTypes.operator
	    				],
	    				tokenModifiers: [
	    					SemanticTokenModifiers.declaration,
	    					SemanticTokenModifiers.definition,
	    					SemanticTokenModifiers.deprecated
	    				]
	    			}
	    		} : undefined,
	    		foldingRangeProvider: true,
	    		selectionRangeProvider: true,
	    		inlayHintProvider: inlayHintSupport ? true : undefined,
                workspaceSymbolProvider: true,
                workspace: {
                    workspaceFolders: {
                        changeNotification: true,
                    },
                },
	    	} as any,
	    }
});

function convertValidatorConfiguration(config: ValidatorConfiguration): ValidatorSettings {
	let fatalError = ValidationSeverity.ERROR;
	let fatalIOError = ValidationSeverity.WARNING;
	if (config) {
		fatalError = getSeverity(config.fatalError);
		fatalIOError = getSeverity(config.fatalIOError);
	}
	return {
        rootUri,
		fatalError,
		fatalIOError,
	};
}

// Solver runs are debounced per document and their results discarded
// when the document changed while the solver was running
const solverTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
// solver diagnostics can land on other files; remember them to clear stale ones
let lastSolverTargets: Set<string> = new Set();

async function runSolverValidation(uri: string): Promise<void> {
	const document = documents.get(uri);
	if (!document) {
		return;
	}
	const version = document.version;
	const settings = configurationSupport
		? convertValidatorConfiguration(await getValidatorConfiguration(uri))
		: (validatorSettings ?? convertValidatorConfiguration(null));
	const [uris, diagnostics] = await service.validateWithSolver(uri, document.getText(), settings);
	if (documents.get(uri)?.version !== version) {
		// stale result, a newer run is scheduled
		return;
	}
	const byUri: Map<string, Diagnostic[]> = new Map();
	uris.forEach((id, i) => {
		const target = byUri.get(id.uri) ?? [];
		target.push(diagnostics[i]);
		byUri.set(id.uri, target);
	});
	// clear solver slices that no longer have errors
	for (const target of lastSolverTargets) {
		if (!byUri.has(target)) {
			byUri.set(target, []);
		}
	}
	if (!byUri.has(uri)) {
		byUri.set(uri, []);
	}
	lastSolverTargets = new Set([...byUri.keys()].filter(u => byUri.get(u).length > 0));
	for (const [target, diags] of byUri) {
		diagnosticsFor(target).solver = diags;
		publishDiagnostics(target);
	}
	if (pullDiagnosticsSupport) {
		connection.languages.diagnostics.refresh();
	}
}

function validateTextDocument(textDocument: TextDocument): void {
	const uri = textDocument.uri;
	const pending = solverTimers.get(uri);
	if (pending) {
		clearTimeout(pending);
	}
	solverTimers.set(uri, setTimeout(() => {
		solverTimers.delete(uri);
		runSolverValidation(uri);
	}, 1000));
}

interface ValidatorConfiguration {
	fatalError?: string,
	fatalIOError?: string,
}

interface CompletionConfiguration {
	// active banana trick: opt-in, off by default (see foamBananaTrick.ts)
	bananaTrick?: boolean,
}

interface Settings {
	foam: {
		languageserver: {
			diagnostics?: ValidatorConfiguration,
			completion?: CompletionConfiguration
		}
	}
}

function applyCompletionConfiguration(config: CompletionConfiguration | null | undefined): void {
	service.setBananaTrick(!!(config && config.bananaTrick));
}

function refreshCompletionConfiguration(): void {
	if (configurationSupport) {
		connection.workspace.getConfiguration({ section: "foam.languageserver.completion" })
			.then((config: CompletionConfiguration) => applyCompletionConfiguration(config));
	}
}

function getSeverity(severity: string | undefined): ValidationSeverity | null {
	switch (severity) {
		case "ignore":
			return ValidationSeverity.IGNORE;
		case "warning":
			return ValidationSeverity.WARNING;
		case "error":
			return ValidationSeverity.ERROR;
	}
	return null;
}

function getValidatorConfiguration(resource: string): Thenable<ValidatorConfiguration> {
	let result = validatorConfigurations.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({ section: "foam.languageserver.diagnostics", scopeUri: resource });
		validatorConfigurations.set(resource, result);
	}
	return result;
}

// listen for notifications when the client's configuration has changed
connection.onNotification(DidChangeConfigurationNotification.type, () => {
	refreshConfigurations();
});

function getConfigurationItems(sectionName): ConfigurationItem[] {
	// store all the URIs that need to be refreshed
	const configurationItems: ConfigurationItem[] = [];
	for (const uri of documents.keys()) {
		configurationItems.push({ section: sectionName, scopeUri: uri });
	}
	return configurationItems;
}

function refreshValidatorConfigurations() {
	// store all the URIs that need to be refreshed
	const settingsRequest = getConfigurationItems("foam.languageserver.diagnostics");
	// clear the cache
	validatorConfigurations.clear();
	// ask the workspace for the configurations
	connection.workspace.getConfiguration(settingsRequest).then((values: ValidatorConfiguration[]) => {
		const toRevalidate: string[] = [];
		for (let i = 0; i < values.length; i++) {
			const resource = settingsRequest[i].scopeUri;
			// a value might have been stored already, use it instead and ignore this one if so
			if (values[i] && !validatorConfigurations.has(resource)) {
				validatorConfigurations.set(resource, Promise.resolve(values[i]));
				toRevalidate.push(resource);
			}
		}

		for (const resource of toRevalidate) {
			const document = documents.get(resource);
			if (document) {
				validateTextDocument(document);
			}
		}
	});
}

// Wipes and reloads the internal cache of configurations.
function refreshConfigurations() {
	refreshValidatorConfigurations();
	refreshCompletionConfiguration();
}

connection.onDidChangeConfiguration((change) => {
	if (configurationSupport) {
		refreshConfigurations();
	} else {
		let settings : Settings = <Settings><unknown>change.settings;
		if (settings.foam && settings.foam.languageserver) {
			if (settings.foam.languageserver.diagnostics) {
				validatorSettings = convertValidatorConfiguration(settings.foam.languageserver.diagnostics);
			}
			applyCompletionConfiguration(settings.foam.languageserver.completion);
		} else {
			validatorSettings = convertValidatorConfiguration(null);
			applyCompletionConfiguration(null);
		}
		// validate all the documents again
		for (const document of documents.all()) {
			validateTextDocument(document);
		}
	}
});

connection.onCompletion((textDocumentPosition: TextDocumentPositionParams): PromiseLike<CompletionItem[]> => {
	return getDocument(textDocumentPosition.textDocument.uri).then((document) => {
		if (document) {
			return service.computeCompletionItems(document.getText(), textDocumentPosition.position, getTree(document), document.uri);
		}
		return null;
	});
});

connection.onSignatureHelp((textDocumentPosition: TextDocumentPositionParams): PromiseLike<SignatureHelp> => {
	return getDocument(textDocumentPosition.textDocument.uri).then((document) => {
		if (document !== null) {
			return service.computeSignatureHelp(document.getText(), textDocumentPosition.position, getTree(document));
		}
		return {
			signatures: [],
			activeSignature: null,
			activeParameter: null,
		};
	});
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	return service.resolveCompletionItem(item);
});

connection.onHover((textDocumentPosition: TextDocumentPositionParams): PromiseLike<Hover> => {
	return getDocument(textDocumentPosition.textDocument.uri).then((document) => {
		if (document) {
			return service.computeHover(document.getText(), textDocumentPosition.position, getTree(document));
		}
		return null;
	});
});

connection.onDocumentHighlight((textDocumentPosition: TextDocumentPositionParams): PromiseLike<DocumentHighlight[]> => {
	return getDocument(textDocumentPosition.textDocument.uri).then((document) => {
		if (document) {
			return service.computeHighlightRanges(textDocumentPosition.textDocument, document.getText(), textDocumentPosition.position, getTree(document));
		}
		return [];
	});
});

connection.onReferences((referenceParams): PromiseLike<Location[]> => {
	return getDocument(referenceParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeReferences(referenceParams.textDocument, document.getText(), referenceParams.position, getTree(document));
		}
		return [];
	});
});

connection.onCodeAction((codeActionParams: CodeActionParams): Command[] | PromiseLike<CodeAction[]> => {
	if (applyEditSupport && codeActionParams.context.diagnostics.length > 0) {
		let commands = service.computeCodeActions(codeActionParams.textDocument, codeActionParams.range, codeActionParams.context);
		if (codeActionQuickFixSupport) {
			return getDocument(codeActionParams.textDocument.uri).then((document) => {
				let codeActions = [];
				for (let command of commands) {
					let codeAction: CodeAction = {
						title: command.title,
						kind: CodeActionKind.QuickFix
					}
					let edit = computeWorkspaceEdit(codeActionParams.textDocument.uri, document, command.command, command.arguments);
					if (edit) {
						codeAction.edit = edit;
					}
					codeActions.push(codeAction);
				}
				return codeActions;
			});
		}
		return commands;
	}
	return [];
});

function computeWorkspaceEdit(uri: string, document: TextDocument, command: string, args: any[]): WorkspaceEdit {
	let edits = service.computeCommandEdits(document.getText(), command, args);
	if (edits) {
		if (documentChangesSupport) {
			let identifier = VersionedTextDocumentIdentifier.create(uri, document.version);
			return {
				documentChanges: [
					TextDocumentEdit.create(identifier, edits)
				]
			};
		} else {
			return {
				changes: {
					[ uri ]: edits
				}
			};
		}
	}
	return null;
}

connection.onExecuteCommand((params: ExecuteCommandParams): void => {
	if (applyEditSupport) {
		let uri: string = params.arguments[0].toString();
		getDocument(uri).then((document) => {
			if (document) {
				let workspaceEdit = computeWorkspaceEdit(uri, document, params.command, params.arguments);
				if (workspaceEdit) {
					connection.workspace.applyEdit(workspaceEdit);
				}
			}
			return null;
		});
	}
});

connection.onDefinition((textDocumentPosition: TextDocumentPositionParams): PromiseLike<Location> => {
	return getDocument(textDocumentPosition.textDocument.uri).then((document) => {
		if (document) {
			return service.computeDefinition(textDocumentPosition.textDocument, document.getText(), textDocumentPosition.position, getTree(document));
		}
		return null;
	});
});

connection.onRenameRequest((params: RenameParams): PromiseLike<WorkspaceEdit> => {
	return getDocument(params.textDocument.uri).then((document) => {
		if (document) {
			// the service builds a full cross-file WorkspaceEdit
			return service.computeRename(params.textDocument, document.getText(), params.position, params.newName, getTree(document));
		}
		return null;
	});
});

connection.onPrepareRename((params: TextDocumentPositionParams): PromiseLike<Range> => {
	return getDocument(params.textDocument.uri).then((document) => {
		if (document) {
			return service.prepareRename(params.textDocument, document.getText(), params.position, getTree(document));
		}
		return null;
	});
});

connection.onDocumentSymbol((documentSymbolParams: DocumentSymbolParams): PromiseLike<SymbolInformation[]> => {
	return getDocument(documentSymbolParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeSymbols(documentSymbolParams.textDocument, document.getText(), getTree(document));
		}
		return [];
	});
});

connection.onWorkspaceSymbol((workspaceSymbolParams: WorkspaceSymbolParams): PromiseLike<SymbolInformation[]> => {
    // the index covers the whole case and mirrors open-document edits
    const index = service.getWorkspaceIndex();
    if (index) {
        const query = (workspaceSymbolParams.query ?? "").toLowerCase();
        const all = index.allSymbols();
        return Promise.resolve(
            query === "" ? all : all.filter(s => s.name.toLowerCase().includes(query)));
    }
    var wSymbols : SymbolInformation[] = [];
	for (const document of documents.all()) {
        const tree = documentCache ? documentCache.getTree(document.uri, document.getText()) : undefined;
        for (const sym of service.computeSymbols(document, document.getText(), tree)) {
            wSymbols.push(sym);
        }
	}
    return Promise.resolve(wSymbols);
})

connection.onDocumentLinks((documentLinkParams: DocumentLinkParams): PromiseLike<DocumentLink[]> => {
	return getDocument(documentLinkParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeLinks(document.uri);
		}
		return [];
	});
});

connection.onDocumentLinkResolve((documentLink: DocumentLink): DocumentLink => {
	return service.resolveLink(documentLink);
});

connection.onFoldingRanges((foldingRangeParams: FoldingRangeParams) => {
	return getDocument(foldingRangeParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeFoldingRanges(document.getText(), getTree(document));
		}
		return [];
	});
});

connection.onSelectionRanges((selectionRangeParams) => {
	return getDocument(selectionRangeParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeSelectionRanges(document.getText(), selectionRangeParams.positions, getTree(document));
		}
		return [];
	});
});

// Fires on open and on every content change; the tree cache was already
// primed with tree.edit()s in the TextDocuments update callback
documents.onDidChangeContent((event) => {
	if (documentCache) {
		const tree = documentCache.refresh(event.document);
		diagnosticsFor(event.document.uri).syntax = syntaxValidator.validate(tree);
		publishDiagnostics(event.document.uri);
		// keep cross-file features aware of unsaved edits
		service.getWorkspaceIndex()?.refreshFromDocument(event.document.uri, event.document.getText(), tree);
	}
	validateTextDocument(event.document);
});

documents.onDidClose((event) => {
	if (documentCache) {
		documentCache.evict(event.document.uri);
	}
	const pending = solverTimers.get(event.document.uri);
	if (pending) {
		clearTimeout(pending);
		solverTimers.delete(event.document.uri);
	}
	validatorConfigurations.delete(event.document.uri);
	diagnosticsState.delete(event.document.uri);
	service.clearSemanticTokensDelta(event.document.uri);
	connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// LSP 3.17 pull diagnostics; only ever requested by clients we advertised
// the diagnosticProvider capability to
connection.languages.diagnostics.on(async (params) => {
	return {
		kind: DocumentDiagnosticReportKind.Full,
		items: mergedDiagnostics(params.textDocument.uri)
	};
});

connection.languages.diagnostics.onWorkspace(async () => {
	return {
		items: Array.from(diagnosticsState.keys(), (uri) => ({
			kind: DocumentDiagnosticReportKind.Full,
			uri,
			version: documents.get(uri)?.version ?? null,
			items: mergedDiagnostics(uri)
		}))
	};
});

connection.languages.semanticTokens.on((semanticTokenParams: SemanticTokensParams) => {
	return getDocument(semanticTokenParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeSemanticTokens(document.getText(), semanticTokenParams.textDocument.uri, getTree(document));
		}
		return {
			data: []
		}
	});
});

connection.languages.semanticTokens.onDelta((deltaParams: any) => {
	return getDocument(deltaParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeSemanticTokensDelta(document.getText(), deltaParams.previousResultId, deltaParams.textDocument.uri, getTree(document));
		}
		return {
			data: []
		}
	});
});

connection.languages.inlayHint.on((inlayHintParams: InlayHintParams) => {
	return getDocument(inlayHintParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeInlayHints(document.getText(), inlayHintParams.range, getTree(document));
		}
		return [];
	});
});

// setup is complete, start listening for client connections
documents.listen(connection);
connection.listen();
