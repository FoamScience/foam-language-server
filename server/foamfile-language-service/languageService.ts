/*
    Main language server implementation
*/
import { FoamLanguageService, ILogger, Capabilities, CompletionItemCapabilities } from "./main";
import {
    TextDocument, Position, CompletionItem, Range, CodeActionContext, Command, TextDocumentIdentifier, SemanticTokens, Location, DocumentHighlight, SymbolInformation, SignatureHelp, DocumentLink, TextEdit, Hover, FormattingOptions, Diagnostic, MarkupKind, FoldingRange, CompletionItemTag, WorkspaceEdit, InlayHint
} from "vscode-languageserver-types";
import * as FoamUtils from '../foamfile-utils/main';
import { FoamAssist } from "./foamAssist";
import { FoamCommands } from "./foamCommands";
import { FoamDefinition } from "./foamDefinition";
import { FoamHighlight } from "./foamHighlight";
import { FoamSymbols } from "./foamSymbols";
import { FoamSignatures } from "./foamSignatures";
import { FoamLinks } from "./foamLinks";
import { PlainTextDocumentation } from "./foamPlainText";
import { FoamRename } from "./foamRename";
import { FoamHover } from "./foamHover";
import { MarkdownDocumentation } from "./foamMarkdown";
import { FoamCompletion } from "./foamCompletion";
import { FoamSemanticTokens } from "./foamSemanticTokens";
import { FoamFolding } from "./foamFolding";
import { FoamWorkspaceIndex } from "./foamWorkspaceIndex";
import { FoamBananaTrick } from "./foamBananaTrick";
import { FoamReferences } from "./foamReferences";
import { FoamSelectionRanges } from "./foamSelectionRanges";
import { FoamInlayHints } from "./foamInlayHints";
import { SemanticTokensBuilder } from 'vscode-languageserver';
import * as Parser from 'tree-sitter';
const foamLanguage = require('tree-sitter-foam');
type TreeParser = Parser;

type Await<T> = T extends PromiseLike<infer U> ? U : T

export class LanguageService implements FoamLanguageService {

    private markdownDocumentation = new MarkdownDocumentation();
    private plainTextDocumentation = new PlainTextDocumentation();
    private logger: ILogger;
    private parser: TreeParser;

    private hoverContentFormat: MarkupKind[];
    private completionItemCapabilities: CompletionItemCapabilities;
    private workspaceIndex: FoamWorkspaceIndex | null = null;
    // per-uri "Valid options" lists harvested from solver errors
    private solverOptions: Map<string, string[]> = new Map();

    // active banana trick: opt-in, off by default
    private bananaTrickEnabled: boolean = false;
    private bananaSolverRunner?: FoamUtils.SolverRunner;
    // per-uri, per-keyword "Valid options" harvested by deliberately
    // provoking the solver with a nonsense ("banana") value
    private bananaCache: Map<string, Map<string, string[]>> = new Map();
    // ponytail: a single flag serializes probes since only one case is ever
    // indexed at a time; would need a per-case-root map for multi-root workspaces
    private bananaProbeRunning: boolean = false;

    private foldingRangeLineFoldingOnly: boolean = false;
    private foldingRangeLimit: number = Number.MAX_VALUE;

    // per-uri resultId for semantic token delta encoding
    private semanticTokenResultIds: Map<string, string> = new Map();

    public setLogger(logger: ILogger): void {
        this.logger = logger;
    }

    public async setTreeParser() : Promise<void> {
        //await Parser.init();
        this.parser = new Parser();
        //const foamLanguage = await Parser.Language.load(`${__dirname}/../../languages/foam.wasm`);
        this.parser.setLanguage(foamLanguage);
        return;
    }

    public getTreeParser() : TreeParser {
        return this.parser;
    }

    public initializeWorkspace(rootUri: string): void {
        this.workspaceIndex = new FoamWorkspaceIndex(this.parser);
        this.workspaceIndex.initialize(rootUri);
    }

    public getWorkspaceIndex(): FoamWorkspaceIndex | null {
        return this.workspaceIndex;
    }


    public setCapabilities(capabilities: Capabilities) {
        this.completionItemCapabilities = capabilities && capabilities.completion && capabilities.completion.completionItem;
        this.hoverContentFormat = capabilities && capabilities.hover && capabilities.hover.contentFormat;
        this.foldingRangeLineFoldingOnly = capabilities && capabilities.foldingRange && capabilities.foldingRange.lineFoldingOnly;
        this.foldingRangeLimit = capabilities && capabilities.foldingRange && capabilities.foldingRange.rangeLimit;
    }

    public computeCodeActions(textDocument: TextDocumentIdentifier, range: Range, context: CodeActionContext): Command[] {
        let foamCommands = new FoamCommands();
        return foamCommands.analyzeDiagnostics(context.diagnostics, textDocument.uri);
    }

    public computeLinks(uri: string): DocumentLink[] {
        let foamLinks = new FoamLinks(this.workspaceIndex);
        return foamLinks.getLinks(uri);
    }

    public resolveLink(link: DocumentLink): DocumentLink {
        let foamLinks = new FoamLinks(this.workspaceIndex);
        return foamLinks.resolveLink(link);
    }

    public computeCommandEdits(content: string, command: string, args: any[]): TextEdit[] {
        let foamCommands = new FoamCommands();
        return foamCommands.computeCommandEdits(content, command, args);
    }

    public computeCompletionItems(content: string, position: Position, tree?: Parser.Tree, uri?: string): CompletionItem[] | PromiseLike<CompletionItem[]> {
        const document = TextDocument.create(uri ?? "", "foam", 0, content);
        const options = uri ? (this.solverOptions.get(uri) ?? []) : [];
        const bananaOptions = uri ? (this.bananaCache.get(uri) ?? new Map<string, string[]>()) : new Map<string, string[]>();
        const probeCallback = (this.bananaTrickEnabled && uri && this.workspaceIndex)
            ? (dictPath: string[]) => this.triggerBananaProbe(uri, dictPath)
            : undefined;
        const foamAssist = new FoamAssist(document, this.completionItemCapabilities, this.parser, this.workspaceIndex, options, probeCallback, bananaOptions);
        return foamAssist.computeProposals(position, tree);
    }

    // Opt-in active banana trick: when enabled, value completion may probe
    // the case's solver in the background for keywords with no known values.
    // solverRunner is test-only injection; production always uses the real
    // spawn-based runner.
    public setBananaTrick(enabled: boolean, solverRunner?: FoamUtils.SolverRunner): void {
        this.bananaTrickEnabled = enabled;
        this.bananaSolverRunner = solverRunner;
    }

    private cacheBananaResult(uri: string, keyword: string, options: string[]): void {
        let forUri = this.bananaCache.get(uri);
        if (!forUri) {
            forUri = new Map();
            this.bananaCache.set(uri, forUri);
        }
        forUri.set(keyword, options);
    }

    // At most one probe in flight at a time; repeat requests for an
    // already-cached (uri, keyword) — including a prior empty result — no-op.
    private triggerBananaProbe(uri: string, dictPath: string[]): void {
        if (!this.workspaceIndex || this.bananaProbeRunning) {
            return;
        }
        const keyword = dictPath[dictPath.length - 1];
        if (this.bananaCache.get(uri)?.has(keyword)) {
            return;
        }
        this.bananaProbeRunning = true;
        new FoamBananaTrick(this.parser, this.bananaSolverRunner).probe(uri, dictPath, this.workspaceIndex)
            .then(options => this.cacheBananaResult(uri, keyword, options))
            .catch(() => this.cacheBananaResult(uri, keyword, []))
            .finally(() => { this.bananaProbeRunning = false; });
    }

    public resolveCompletionItem(item: CompletionItem): CompletionItem {
        if (!item.documentation) {
            let foamCompletion = new FoamCompletion();
            return foamCompletion.resolveCompletionItem(item, this.completionItemCapabilities && this.completionItemCapabilities.documentationFormat);
        }
        return item;
    }

    public computeDefinition(textDocument: TextDocumentIdentifier, content: string, position: Position, tree?: Parser.Tree): Location {
        let foamDefinition = new FoamDefinition(this.parser, this.workspaceIndex);
        return foamDefinition.computeDefinition(textDocument, content, position, tree);
    }

    public computeReferences(textDocument: TextDocumentIdentifier, content: string, position: Position, tree?: Parser.Tree): Location[] {
        let foamReferences = new FoamReferences(this.parser, this.workspaceIndex);
        return foamReferences.computeReferences(textDocument, content, position, tree);
    }

    public computeFoldingRanges(content: string, tree?: Parser.Tree): FoldingRange[] {
        let foamFolding = new FoamFolding(this.parser);
        return foamFolding.computeFoldingRanges(content, this.foldingRangeLineFoldingOnly, this.foldingRangeLimit, tree);
    }

    public computeSelectionRanges(content: string, positions: Position[], tree?: Parser.Tree): import('vscode-languageserver-types').SelectionRange[] {
        let foamSelectionRanges = new FoamSelectionRanges(this.parser);
        return foamSelectionRanges.computeSelectionRanges(content, positions, tree);
    }

    public computeHighlightRanges(textDocument: TextDocumentIdentifier, content: string, position: Position, tree?: Parser.Tree): DocumentHighlight[] {
        let foamHighlight = new FoamHighlight(this.parser, this.workspaceIndex);
        return foamHighlight.computeHighlightRanges(textDocument, content, position, tree);
    }

    public computeHover(content: string, position: Position, tree?: Parser.Tree): Hover | null {
        let foamHover = new FoamHover(this.markdownDocumentation, this.plainTextDocumentation, this.parser);
        return foamHover.onHover(content, position, this.hoverContentFormat, tree);
    }

    public computeSymbols(textDocument: TextDocumentIdentifier, content: string, tree?: Parser.Tree): SymbolInformation[] {
        let foamSymbols = new FoamSymbols(this.parser);
        return foamSymbols.parseSymbolInformation(textDocument, content, tree);
    }

    public computeSignatureHelp(content: string, position: Position, tree?: Parser.Tree): SignatureHelp {
        let foamSignature = new FoamSignatures(this.parser);
        return foamSignature.computeSignatures(content, position, tree);
    }

    public computeRename(textDocument: TextDocumentIdentifier, content: string, position: Position, newName: string, tree?: Parser.Tree): WorkspaceEdit | null {
        let foamRename = new FoamRename(this.parser, this.workspaceIndex);
        return foamRename.rename(textDocument, content, position, newName, tree);
    }

    public prepareRename(textDocument: TextDocumentIdentifier, content: string, position: Position, tree?: Parser.Tree): Range | null {
        let foamRename = new FoamRename(this.parser, this.workspaceIndex);
        return foamRename.prepareRename(textDocument, content, position, tree);
    }

    public computeSemanticTokens(content: string, uri?: string, tree?: Parser.Tree): SemanticTokens {
        let foamSemanticTokens = new FoamSemanticTokens(content, this.parser);
        const result = foamSemanticTokens.computeSemanticTokens(tree);
        if (uri && result.resultId) {
            this.semanticTokenResultIds.set(uri, result.resultId);
        }
        return result;
    }

    public computeSemanticTokensDelta(content: string, previousResultId: string | undefined, uri: string, tree?: Parser.Tree): SemanticTokens {
        const foamSemanticTokens = new FoamSemanticTokens(content, this.parser);
        const builder = new SemanticTokensBuilder();
        if (previousResultId && this.semanticTokenResultIds.get(uri) === previousResultId) {
            builder.previousResult(previousResultId);
        }
        foamSemanticTokens.pushTokens(builder, tree);
        const result = builder.build();
        if (result.resultId) {
            this.semanticTokenResultIds.set(uri, result.resultId);
        }
        return result;
    }

    public clearSemanticTokensDelta(uri: string): void {
        this.semanticTokenResultIds.delete(uri);
    }

    public computeInlayHints(content: string, range: Range, tree?: Parser.Tree): InlayHint[] {
        let foamInlayHints = new FoamInlayHints(this.parser);
        return foamInlayHints.computeInlayHints(content, range, tree);
    }

    public validate(content: string, parser: TreeParser, settings?: FoamUtils.ValidatorSettings, tree?: Parser.Tree): [TextDocumentIdentifier[], Diagnostic[]] {
        return FoamUtils.validate(content, parser, settings, tree);
    }

    public async validateWithSolver(uri: string, content: string, settings?: FoamUtils.ValidatorSettings): Promise<[TextDocumentIdentifier[], Diagnostic[]]> {
        const [uris, diagnostics, errors] = await FoamUtils.validateWithSolver(uri, content, this.parser, settings);
        // passive banana trick: remember "Valid options" lists from solver
        // errors, surfaced later as value completions
        // ponytail: keyed by target uri only; per-keyword scoping if it bites
        for (const error of errors) {
            if (error.options && error.options.length > 0) {
                this.solverOptions.set(error.uri ?? uri, error.options);
            }
        }
        return [uris, diagnostics];
    }
}
