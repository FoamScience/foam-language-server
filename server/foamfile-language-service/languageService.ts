/*
    Main language server implementation
*/
import { FoamLanguageService, ILogger, Capabilities, CompletionItemCapabilities, FormatterSettings } from "./main";
import {
    TextDocument, Position, CompletionItem, Range, CodeActionContext, Command, TextDocumentIdentifier, SemanticTokens, Location, DocumentHighlight, SymbolInformation, SignatureHelp, DocumentLink, TextEdit, Hover, FormattingOptions, Diagnostic, MarkupKind, FoldingRange, CompletionItemTag
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
import * as Parser from 'tree-sitter';
const foamLanguage = require('tree-sitter-foam');
type TreeParser = Parser;
//import { getParser } from './foamTreeParser'
//import { FoamFormatter } from "./foamFormatter";

type Await<T> = T extends PromiseLike<infer U> ? U : T

export class LanguageService implements FoamLanguageService {

    private markdownDocumentation = new MarkdownDocumentation();
    private plainTextDocumentation = new PlainTextDocumentation();
    private logger: ILogger;
    private parser: TreeParser;

    private hoverContentFormat: MarkupKind[];
    private completionItemCapabilities: CompletionItemCapabilities;

    private foldingRangeLineFoldingOnly: boolean = false;
    private foldingRangeLimit: number = Number.MAX_VALUE;

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

    public computeLinks(content: string): DocumentLink[] {
        let foamLinks = new FoamLinks();
        return foamLinks.getLinks(content);
    }

    public resolveLink(link: DocumentLink): DocumentLink {
        let foamLinks = new FoamLinks();
        return foamLinks.resolveLink(link);
    }

    public computeCommandEdits(content: string, command: string, args: any[]): TextEdit[] {
        let foamCommands = new FoamCommands();
        return foamCommands.computeCommandEdits(content, command, args);
    }

    public computeCompletionItems(content: string, position: Position): CompletionItem[] | PromiseLike<CompletionItem[]> {
        const document = TextDocument.create("", "", 0, content);
        const foamAssist = new FoamAssist(document, this.completionItemCapabilities, this.parser);
        return foamAssist.computeProposals(position);
    }

    public resolveCompletionItem(item: CompletionItem): CompletionItem {
        if (!item.documentation) {
            let foamCompletion = new FoamCompletion();
            return foamCompletion.resolveCompletionItem(item, this.completionItemCapabilities && this.completionItemCapabilities.documentationFormat);
        }
        return item;
    }

    public computeDefinition(textDocument: TextDocumentIdentifier, content: string, position: Position): Location {
        let foamDefinition = new FoamDefinition(this.parser);
        return foamDefinition.computeDefinition(textDocument, content, position);
    }

    public computeFoldingRanges(content: string): FoldingRange[] {
        let foamFolding = new FoamFolding();
        return foamFolding.computeFoldingRanges(content, this.foldingRangeLineFoldingOnly, this.foldingRangeLimit);
    }

    public computeHighlightRanges(content: string, position: Position): DocumentHighlight[] {
        let foamHighlight = new FoamHighlight();
        return foamHighlight.computeHighlightRanges(content, position);
    }

    public computeHover(content: string, position: Position): Hover | null {
        let foamHover = new FoamHover(this.markdownDocumentation, this.plainTextDocumentation, this.parser);
        return foamHover.onHover(content, position, this.hoverContentFormat);
    }

    public computeSymbols(textDocument: TextDocumentIdentifier, content: string): SymbolInformation[] {
        let foamSymbols = new FoamSymbols(this.parser);
        return foamSymbols.parseSymbolInformation(textDocument, content);
    }

    public computeSignatureHelp(content: string, position: Position): SignatureHelp {
        let foamSignature = new FoamSignatures(this.parser);
        return foamSignature.computeSignatures(content, position);
    }

    public computeRename(textDocument: TextDocumentIdentifier, content: string, position: Position, newName: string): TextEdit[] {
        let foamRename = new FoamRename();
        return foamRename.rename(textDocument, content, position, newName);
    }

    public prepareRename(content: string, position: Position): Range | null {
        let foamRename = new FoamRename();
        return foamRename.prepareRename(content, position);
    }

    public computeSemanticTokens(content: string): SemanticTokens {
        let foamSemanticTokens = new FoamSemanticTokens(content, this.parser);
        return foamSemanticTokens.computeSemanticTokens();
    }

    public validate(content: string, parser: TreeParser, settings?: FoamUtils.ValidatorSettings): [TextDocumentIdentifier[], Diagnostic[]] {
        return FoamUtils.validate(content, parser, settings);
    }

    //public format(content: string, settings: FormatterSettings): TextEdit[] {
    //    return FoamUtils.format(content, settings);
    //}

    //public formatRange(content: string, range: Range, settings: FormatterSettings): TextEdit[] {
    //    return FoamUtils.formatRange(content, range, settings);
    //}

    //public formatOnType(content: string, position: Position, ch: string, settings: FormatterSettings): TextEdit[] {
    //    return FoamUtils.formatOnType(content, position, ch, settings);
    //}
}
