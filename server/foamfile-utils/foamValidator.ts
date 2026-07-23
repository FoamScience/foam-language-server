/*
    Validate OpenFOAM dictionaries and compute diagnostics
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Can run a solver and parse common error messages and valid entries
    - Returns the URI to the erronous file if any, so it's workspace-ready

    Possible Improvements:
    - Support OF9 and if possible ESI version
*/

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Position, Range, DocumentUri, TextDocumentIdentifier } from 'vscode-languageserver-types';
import { CustomErrorRule, ValidationCode, ValidationSeverity, ValidatorSettings } from './main';
import { copyCaseSkeleton } from './scratchCase';

import * as TreeParser from 'tree-sitter';

import { spawn } from 'child_process';
import { readFileSync, existsSync, statSync, promises as fsp } from 'fs';
import * as os from 'os';
var path = require('path');

// Async solver runs are hard-killed on whichever comes first:
// this timeout, a "FOAM exiting/aborting" sentinel, or the output cap.
// Without these, a *valid* case would happily run the whole simulation.
const SOLVER_TIMEOUT_MS = 5000;
const OUTPUT_CAP = 1024 * 1024;

// mesh-check style complaints ("***Number of severely non-orthogonal
// faces...") that utilities print to stdout without any FOAM banner; only
// applied to utility output so solver diagnostics keep their exact shape
const UTILITY_RULES: CustomErrorRule[] = [
    { name: 'mesh-check', pattern: '^\\s*\\*\\*\\*(?<message>.+)$', severity: 'warning' },
];

const RULE_SEVERITIES: { [name: string]: DiagnosticSeverity } = {
    error: DiagnosticSeverity.Error,
    warning: DiagnosticSeverity.Warning,
    info: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
};

// Runs a program in `cwd` and resolves to its combined stdout+stderr.
// Defaults to Validator's own spawn-based implementation; injectable so
// callers (the active banana trick, tests) can stub the process layer.
export type SolverRunner = (solver: string, cwd: string, args?: string[]) => Promise<string>;

// A representation of an OpenFOAM error
export class ParsedError {
    uri: DocumentUri;
    errorType: string;
    message: string;
    start: number;
    end: number;
    options: string[];
    severity?: DiagnosticSeverity;
    // dict entry the error names ("fvSchemes.ddtSchemes.default" ->
    // ["ddtSchemes", "default"]), scoping any options list to it
    dictPath?: string[];
}

export class Validator {

    private document: TextDocument;
    // A local reference to the Tree-Sitter Parser
    private treeParser : TreeParser;
    // defaults to this.runSolverAsync; overridable so callers can stub the
    // process layer (the active banana trick, tests)
    private solverRunner: SolverRunner;


    private settings: ValidatorSettings = {
        rootUri: null,
        fatalError: ValidationSeverity.ERROR,
        fatalIOError: ValidationSeverity.WARNING,
    }

    constructor(parser : TreeParser, settings?: ValidatorSettings, solverRunner?: SolverRunner) {
        if (settings) {
            this.settings = settings;
        }
        this.treeParser = parser;
        this.solverRunner = solverRunner ?? ((solver, cwd, args) => this.runSolverAsync(solver, cwd, args));
    }

    /*
        Parse ALL OpenFOAM errors/warnings out of a solver's stderr.
        Handles foundation (.org) and ESI (.com) formats, fatal errors,
        fatal IO errors and warnings. Unparseable blocks degrade to a
        message-only error on line 1 — never throws.
    */
    public parseFoamErrors(text: string, caseRoot?: string): ParsedError[] {
        const results: ParsedError[] = [];
        const marker = /(?:-->\s*)?FOAM (FATAL IO ERROR|FATAL ERROR|IOWarning|Warning)\s*:?/g;
        const hits: { kind: string, bodyStart: number, index: number }[] = [];
        let m: RegExpExecArray;
        while ((m = marker.exec(text)) !== null) {
            hits.push({ kind: m[1], index: m.index, bodyStart: marker.lastIndex });
        }
        for (let i = 0; i < hits.length; i++) {
            let block = text.slice(hits[i].bodyStart, i + 1 < hits.length ? hits[i + 1].index : text.length);
            // errors end at the exiting/aborting sentinel
            block = block.split(/FOAM (?:exiting|aborting)/)[0];
            // ESI puts its version tag right after the marker
            block = block.replace(/^\s*\(openfoam-[^)]*\)/, '');
            results.push(this.parseErrorBlock(hits[i].kind, block, caseRoot));
        }
        return results;
    }

    private parseErrorBlock(kind: string, block: string, caseRoot?: string): ParsedError {
        const result = new ParsedError();
        const isWarning = kind.endsWith('Warning');
        result.errorType = kind === 'Warning' ? 'FOAM Warning' : `FOAM ${kind}`;
        result.severity = isWarning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error;
        result.start = 1;
        result.end = 1;
        result.options = [];

        // message: lines up to the first blank line, minus C++ source frames.
        // Foundation leaves a trailing space after the marker's colon, so
        // the first line is blank and the message starts one line down
        const lines = block.split('\n');
        const messageLines: string[] = [];
        for (const line of lines) {
            if (line.trim() === '') {
                if (messageLines.length === 0) { continue; }
                break;
            }
            if (/^\s*(?:From function|From |in file|file:)/.test(line)) { continue; }
            messageLines.push(line.trim());
        }
        result.message = messageLines.join(' ').trim();
        if (!result.message) {
            result.message = `Couldn't parse ${result.errorType} message`;
        }

        // location: "file: X at line N." / "file: X from line N to line M."
        // warnings instead say: ... reading "X" at line N
        let file: string = null;
        const fileMatch = block.match(/file:\s*(\S+?)\s+(?:at line\s+(\d+)|from line\s+(\d+)\s+to line\s+(\d+))\s*\./);
        const readingMatch = block.match(/[Rr]eading\s+"([^"]+)"\s+at line\s+(\d+)/);
        if (fileMatch) {
            file = fileMatch[1];
            result.start = +(fileMatch[2] ?? fileMatch[3]);
            result.end = +(fileMatch[4] ?? result.start);
        } else if (readingMatch) {
            file = readingMatch[1];
            result.start = +readingMatch[2];
            result.end = result.start;
        }
        if (file) {
            this.locateFile(result, file, caseRoot);
        }

        // "Valid xxx types are : N ( a b c )" lists feed value completion
        const optionsMatch = block.match(/[Vv]alid[^\n]*\n\s*\n?\s*\d+\s*\(\s*\n?([\s\S]*?)\)/);
        if (optionsMatch) {
            result.options = optionsMatch[1].split(/\s+/).filter(s => s.length > 0);
        }
        return result;
    }

    /*
        OpenFOAM appends the offending dictionary entry to the file name it
        reports: current versions separate it with '/'
        (".../fvSchemes/ddtSchemes/default"), older ones used '.'
        (".../fvSchemes.ddtSchemes.default"). ESI also reports the path
        relative to the case root, foundation reports it absolute.

        Splitting the two apart is done by asking the filesystem where the
        real file ends — no version sniffing. Only when nothing on disk
        matches (unit tests, a file deleted since the run) does the dotted
        heuristic apply.
    */
    private locateFile(result: ParsedError, file: string, caseRoot?: string): void {
        const full = path.isAbsolute(file) || !caseRoot ? file : path.join(caseRoot, file);
        const segments: string[] = [];
        let candidate = full;
        while (candidate) {
            if (this.isFile(candidate)) {
                result.uri = "file://" + candidate;
                if (segments.length > 0) {
                    result.dictPath = segments;
                }
                return;
            }
            const parent = path.dirname(candidate);
            if (parent === candidate) { break; }
            segments.unshift(path.basename(candidate));
            candidate = parent;
        }
        // nothing on disk: fall back to the dotted form. ponytail: also
        // splits real dotted basenames, which OpenFOAM case files don't
        // have in practice
        const parts = path.basename(full).split('.');
        result.uri = "file://" + path.join(path.dirname(full), parts[0]);
        if (parts.length > 1) {
            result.dictPath = parts.slice(1);
        }
    }

    private isFile(candidate: string): boolean {
        try {
            return statSync(candidate).isFile();
        } catch {
            return false;
        }
    }

    /*
        Run user-supplied (and built-in utility) rules over a program's
        output. Each rule is one regex whose named groups fill the parsed
        error; a bad regex degrades to a warning diagnostic instead of
        throwing into the diagnostics path.
    */
    public parseWithRules(text: string, rules: CustomErrorRule[], caseRoot?: string): ParsedError[] {
        const results: ParsedError[] = [];
        for (const rule of rules) {
            if (!rule || typeof rule.pattern !== 'string' || rule.pattern === '') {
                continue;
            }
            let re: RegExp;
            try {
                re = new RegExp(rule.pattern, 'gm');
            } catch {
                const bad = new ParsedError();
                bad.errorType = rule.name ?? 'custom-rule';
                bad.severity = DiagnosticSeverity.Warning;
                bad.message = `Invalid custom rule regex: ${rule.pattern}`;
                bad.start = 1;
                bad.end = 1;
                bad.options = [];
                results.push(bad);
                continue;
            }
            let m: RegExpExecArray;
            while ((m = re.exec(text)) !== null) {
                if (m.index === re.lastIndex) {
                    re.lastIndex++;
                }
                const groups = m.groups ?? {};
                const result = new ParsedError();
                result.errorType = rule.name ?? 'custom-rule';
                result.severity = RULE_SEVERITIES[rule.severity] ?? DiagnosticSeverity.Warning;
                result.message = (groups.message ?? m[0]).trim();
                result.start = groups.line ? +groups.line : 1;
                result.end = groups.endLine ? +groups.endLine : result.start;
                result.options = groups.options
                    ? groups.options.split(/\s+/).filter(s => s.length > 0)
                    : [];
                if (groups.file) {
                    this.locateFile(result, groups.file, caseRoot);
                }
                results.push(result);
            }
        }
        return results;
    }

    // Map a parsed error to the severity configured for its type;
    // null means the diagnostic is suppressed
    private severityFor(error: ParsedError): DiagnosticSeverity | null {
        let configured: ValidationSeverity;
        switch (error.errorType) {
            case 'FOAM FATAL ERROR': configured = this.settings.fatalError; break;
            case 'FOAM FATAL IO ERROR': configured = this.settings.fatalIOError; break;
            case 'FOAM Warning':
            case 'FOAM IOWarning': configured = this.settings.warning ?? ValidationSeverity.WARNING; break;
            // rule-produced errors carry their rule's severity
            default: return error.severity ?? DiagnosticSeverity.Warning;
        }
        switch (configured) {
            case ValidationSeverity.IGNORE: return null;
            case ValidationSeverity.WARNING: return DiagnosticSeverity.Warning;
            default: return DiagnosticSeverity.Error;
        }
    }

    // Walk up from a directory to the enclosing OpenFOAM case root
    private findCaseRoot(startDir: string): string | null {
        let dir = startDir;
        while (true) {
            if (existsSync(path.join(dir, 'system', 'controlDict'))) {
                return dir;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                return null;
            }
            dir = parent;
        }
    }

    // Spawn a program, collect its stdout AND stderr, always kill the
    // child. Utilities like checkMesh print their complaints to stdout;
    // the FOAM banners go to stderr — the parser gets both.
    private runSolverAsync(solver: string, cwd: string, args: string[] = []): Promise<string> {
        return new Promise((resolve) => {
            let child;
            try {
                child = spawn(solver, args, {
                    cwd,
                    // ESI OpenFOAM compares $PWD against cwd() and warns
                    // on every run when they disagree — which they always
                    // do for a server spawned from the editor's directory
                    env: { ...process.env, PWD: cwd },
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            } catch {
                resolve('');
                return;
            }
            let output = '';
            let done = false;
            const finish = () => {
                if (!done) {
                    done = true;
                    clearTimeout(timer);
                    try { child.kill('SIGKILL'); } catch { /* already gone */ }
                    resolve(output);
                }
            };
            const timer = setTimeout(finish, SOLVER_TIMEOUT_MS);
            const collect = (data) => {
                output += data.toString();
                if (output.length >= OUTPUT_CAP || /FOAM (?:exiting|aborting)/.test(output)) {
                    finish();
                }
            };
            child.stdout.on('data', collect);
            child.stderr.on('data', collect);
            child.on('error', finish);
            child.on('close', finish);
        });
    }

    /*
        Async diagnostics: run the case's solver (plus any configured
        utilities, against a scratch copy — setFields and friends mutate
        the case), parse every error and warning from their output.
        Resolves to parallel arrays: uris[i] is the file diagnostics[i]
        belongs to.
    */
    public async validateWithSolver(document: TextDocument): Promise<[TextDocumentIdentifier[], Diagnostic[], ParsedError[]]> {
        this.document = document;
        const docPath = document.uri.startsWith("file://") ? document.uri.replace("file://", '') : null;
        let root = this.settings.rootUri ? this.settings.rootUri.replace("file://", '') : null;
        if (!root || !existsSync(path.join(root, 'system', 'controlDict'))) {
            root = docPath ? this.findCaseRoot(path.dirname(docPath)) : null;
        }
        if (!root) {
            // not an OpenFOAM case (or no controlDict yet): solver layer is off
            return [[], [], []];
        }
        let controlDict: string;
        try {
            controlDict = readFileSync(path.join(root, 'system', 'controlDict'), 'ascii');
        } catch {
            return [[], [], []];
        }
        let solver: string;
        for (const entry of this.getKeywordValue(controlDict, "application")) {
            // Last one wins
            solver = entry;
        }
        if (!solver) {
            return [[], [], []];
        }
        const runs: { command: string, args: string[], cwd: string }[] =
            [{ command: solver, args: [], cwd: root }];
        let scratchDir: string = null;
        const utilities = this.settings.utilities ?? [];
        if (utilities.length > 0) {
            scratchDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'foam-utils-'));
            await copyCaseSkeleton(root, scratchDir);
            for (const utility of utilities) {
                const words = utility.split(/\s+/).filter(w => w.length > 0);
                if (words.length > 0) {
                    runs.push({ command: words[0], args: words.slice(1), cwd: scratchDir });
                }
            }
        }
        const uris: TextDocumentIdentifier[] = [];
        const problems: Diagnostic[] = [];
        const allErrors: ParsedError[] = [];
        try {
            for (const run of runs) {
                const isUtility = run.cwd === scratchDir;
                const output = await this.solverRunner(run.command, run.cwd, run.args);
                const rules = [
                    ...(isUtility ? UTILITY_RULES : []),
                    ...(this.settings.customRules ?? []),
                ];
                // A utility that cannot run at all (setFields without a
                // setFieldsDict, checkMesh before blockMesh) prints a
                // banner naming no case file: environmental noise about a
                // program the user opted into, not a mistake in the
                // document being edited, so it is dropped. Rule matches
                // are kept — they are the findings the utility was run
                // for, and land on the current document when they name no
                // file of their own.
                const banners = this.parseFoamErrors(output, run.cwd)
                    .filter(e => !isUtility || e.uri !== undefined);
                const errors = banners.concat(this.parseWithRules(output, rules, run.cwd));
                for (const error of errors) {
                    // utility errors name scratch-copy paths; point them
                    // back at the user's own files
                    if (error.uri && scratchDir && error.uri.startsWith('file://' + scratchDir)) {
                        error.uri = 'file://' + path.join(root, path.relative(scratchDir, error.uri.replace('file://', '')));
                    }
                    allErrors.push(error);
                    const severity = this.severityFor(error);
                    if (severity === null) {
                        continue;
                    }
                    problems.push(Diagnostic.create(
                        Range.create(Math.max(error.start - 1, 0), 0, Math.max(error.end - 1, 0), 3),
                        error.message,
                        severity,
                        error.errorType,
                        run.command,
                    ));
                    uris.push({ uri: error.uri === undefined ? document.uri : error.uri });
                }
            }
        } finally {
            if (scratchDir) {
                await fsp.rm(scratchDir, { recursive: true, force: true });
            }
        }
        return [uris, problems, allErrors];
    }

    // Look for a keyword and return its value using TreeSitter
    // You have to use this generator multiple times if you want to capture
    // all occurrences of keyword
    // TODO: Make this generator scope-aware
    public* getKeywordValue(content: string, keyword: string) {
        let document : TextDocument = TextDocument.create("", "foam", 0, content);
        const tree = this.treeParser.parse(content);

        let cursor = tree.walk();
        let reached_root = false;
        while (reached_root == false) 
        {
            let values = [];
            let node = cursor.currentNode;
            // If a node matches the keyword
            if (node.type == 'key_value' && node.namedChild(0).text == keyword){
                for (const { index, value } of node.children.map((value, index) => ({ index, value }))) {
                    // Take everything between keyword and ";"
                    if (index != 0 && index != node.children.length-1) {
                        values.push(value.text);
                    }
                }
                yield values.join(' ');
                if (cursor.gotoNextSibling()) continue;
            }

            if (cursor.gotoFirstChild()) continue;
            if (cursor.gotoNextSibling()) continue;
            let retracing = true;
            while (retracing)
            {
                if (cursor.gotoParent() == false){
                    retracing = false;
                    reached_root = true;
                }

                if (cursor.gotoNextSibling()) {
                    retracing = false;
                }
            }
        }
    }
    static createWarning(start: Position, end: Position, description: string, code?: ValidationCode, tags?: DiagnosticTag[]): Diagnostic {
        return Validator.createDiagnostic(DiagnosticSeverity.Warning, start, end, description, code, tags);
    }

    static createDiagnostic(severity: DiagnosticSeverity, start: Position, end: Position, description: string, code?: ValidationCode, tags?: DiagnosticTag[]): Diagnostic {
        return {
            range: {
                start: start,
                end: end
            },
            message: description,
            severity: severity,
            code: code,
            tags: tags,
            source: "foamfile-utils"
        };
    }
}
