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
import { ValidationCode, ValidationSeverity, ValidatorSettings } from './main';

import * as TreeParser from 'tree-sitter';

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
var path = require('path');

// Async solver runs are hard-killed on whichever comes first:
// this timeout, a "FOAM exiting/aborting" sentinel, or the stderr cap.
// Without these, a *valid* case would happily run the whole simulation.
const SOLVER_TIMEOUT_MS = 5000;
const STDERR_CAP = 1024 * 1024;

// Try to figure out OpenFOAM-related env vars
const of_fork = process.env.WM_PROJECT
const of_version = process.env.WM_PROJECT_VERSION
const of_compile_option = process.env.WM_COMPILE_OPTION
const usr_libs = process.env.FOAM_USER_LIBBIN
const usr_bins = process.env.FOAM_USER_APPBIN

// Runs a solver in `cwd` and resolves to whatever it wrote to stderr.
// Defaults to Validator's own spawn-based implementation; injectable so
// callers (the active banana trick, tests) can stub the process layer.
export type SolverRunner = (solver: string, cwd: string) => Promise<string>;

// A representation of an OpenFOAM error
export class ParsedError {
    uri: DocumentUri;
    errorType: string;
    message: string;
    start: number;
    end: number;
    options: string[];
    severity?: DiagnosticSeverity;
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
        this.solverRunner = solverRunner ?? ((solver, cwd) => this.runSolverAsync(solver, cwd));
    }

    /*
        Parses an OpenFOAM error
        Takes:
        - The content of stderr from OpenFOAM solvers
        Returns:
        - Error type
        - The error message
        - Start position
        - End position
        - Valid entries (optional) for completion
    */
    parseFoamError(text: string) : ParsedError {

        const result = new ParsedError();

        // Prepare text string (what's in stderr)
        text = text.replace(/\r?\n/g, " ").replace(/\s+/, " ")

        // Extract first file name appearning
        const fileRegExp : RegExp = /file:?\s*([-\w\/\.\+]+)/
        const filenames : RegExpMatchArray = text.match(fileRegExp);
        if (filenames.length > 1) {
            result.uri = ["file://", filenames[1]].join('');
        }

        // Parse fatal errors
        const fatalErrorRegexp : RegExp = /FOAM FATAL ERROR/
        let isFatalError = fatalErrorRegexp.test(text);
        if (isFatalError)
        {
            // A RegExp matching most errors
            const theRegExp : RegExp =
                /FOAM FATAL ERROR[\s\S]*?(\w.*?)in.*?"(.*?)"[\s\S]*?line\s*(\d+).*?(?:line\s*(\d+))?.*\n*(?:[vV]alid[\s\S]*?(\d+)[\s\S]*?\(([\s\S]*?)\))?/m
                ///FOAM FATAL IO ERROR[\s\S]*?(\w.*)[\s\S].*?(?:[vV]alid.*?(\d+))?[\s\S]*?\((.*?)\)[\s\S]*?file:\s*(.[^\s]*).*?line\s(\d+).*?(?:line (\d+).*)?FOAM exiting/m
            const matches : RegExpMatchArray = text.match(theRegExp);
            
            let errType = "FOAM FATAL ERROR";
            let message = "Couldn't parse error string";
            let positions = ["0", "0"];
            let options : string[];

            message = matches[1];
            if (matches[4] === undefined)
            {
                positions = [matches[3], matches[3]];
            } else {
                positions = [matches[3], matches[4]];
            }

            result.errorType = errType.toString();
            result.message = message.toString();
            result.start = +positions[0];
            result.end = +positions[1];
            result.options = options;
            return result;
        }

        // Parse fatal IO errors
        const fatalIOErrorRegexp : RegExp = /FOAM FATAL IO ERROR/
        let isFatalIOError = fatalIOErrorRegexp.test(text);
        if (isFatalIOError)
        {
            // A RegExp matching most IO errors
            const theRegExp : RegExp =
                /FOAM FATAL IO ERROR[\s\S]*?(\w.*)[\s\S].*?(?:[vV]alid.*?(\d+)[\s\S]*?\((.*?)\)[\s\S]*?)?file:\s*(.[^\s]*).*?line\s(\d+).*?(?:line (\d+).*)?FOAM exiting/m
                ///FOAM FATAL IO ERROR[\s\S]*?(\w.*)[\s\S].*?(?:[vV]alid.*?(\d+))?[\s\S]*?\((.*?)\)[\s\S]*?file:\s*(.[^\s]*).*?line\s(\d+).*?(?:line (\d+).*)?FOAM exiting/m
            const matches : RegExpMatchArray = text.match(theRegExp);
            
            let errType = "FOAM FATAL IO ERROR";
            let message = "Couldn't parse IO error string";
            let positions = ["0", "0"];
            let options: string[];

            if (matches.length == 7)
            {
                message = matches[1];
                if (matches[6] === undefined)
                {
                    positions = [matches[5], matches[5]];
                } else {
                    positions = [matches[5], matches[6]];
                }
                //options = matches[3].split(/\s+/);
            }
            result.errorType = errType.toString();
            result.message = message.toString();
            result.start = +positions[0];
            result.end = +positions[1];
            result.options = options;
            return result;
        }

        return {
            uri: this.document.uri,
            errorType: "",
            message: "",
            start: 0,
            end: 0,
            options: []
        };
    }

    /*
        Parse ALL OpenFOAM errors/warnings out of a solver's stderr.
        Handles foundation (.org) and ESI (.com) formats, fatal errors,
        fatal IO errors and warnings. Unparseable blocks degrade to a
        message-only error on line 1 — never throws.
    */
    public parseFoamErrors(text: string): ParsedError[] {
        const results: ParsedError[] = [];
        const marker = /(?:-->\s*)?FOAM (FATAL IO ERROR|FATAL ERROR|Warning)\s*:?/g;
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
            results.push(this.parseErrorBlock(hits[i].kind, block));
        }
        return results;
    }

    private parseErrorBlock(kind: string, block: string): ParsedError {
        const result = new ParsedError();
        result.errorType = kind === 'Warning' ? 'FOAM Warning' : `FOAM ${kind}`;
        result.severity = kind === 'Warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error;
        result.start = 1;
        result.end = 1;
        result.options = [];

        // message: lines up to the first blank line, minus C++ source frames
        const lines = block.replace(/^\n+/, '').split('\n');
        const messageLines: string[] = [];
        for (const line of lines) {
            if (line.trim() === '') { break; }
            if (/^\s*(?:From function|in file|file:)/.test(line)) { continue; }
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
            // OpenFOAM appends the offending dictionary path to the file name
            // with dots (".../fvSchemes.ddtSchemes.default") — strip it from
            // the basename. ponytail: also strips real dotted basenames,
            // which OpenFOAM case files don't have in practice
            const dir = path.dirname(file);
            const base = path.basename(file).split('.')[0];
            result.uri = "file://" + path.join(dir, base);
        }

        // "Valid xxx types are : N ( a b c )" lists feed value completion
        const optionsMatch = block.match(/[Vv]alid[^\n]*\n\s*\n?\s*\d+\s*\(\s*\n?([\s\S]*?)\)/);
        if (optionsMatch) {
            result.options = optionsMatch[1].split(/\s+/).filter(s => s.length > 0);
        }
        return result;
    }

    // Map a parsed error to the severity configured for its type;
    // null means the diagnostic is suppressed
    private severityFor(error: ParsedError): DiagnosticSeverity | null {
        let configured: ValidationSeverity;
        switch (error.errorType) {
            case 'FOAM FATAL ERROR': configured = this.settings.fatalError; break;
            case 'FOAM FATAL IO ERROR': configured = this.settings.fatalIOError; break;
            default: return DiagnosticSeverity.Warning;
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

    // Spawn the solver, collect stderr, always kill the child
    private runSolverAsync(solver: string, cwd: string): Promise<string> {
        return new Promise((resolve) => {
            let child;
            try {
                child = spawn(solver, [], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
            } catch {
                resolve('');
                return;
            }
            let stderr = '';
            let done = false;
            const finish = () => {
                if (!done) {
                    done = true;
                    clearTimeout(timer);
                    try { child.kill('SIGKILL'); } catch { /* already gone */ }
                    resolve(stderr);
                }
            };
            const timer = setTimeout(finish, SOLVER_TIMEOUT_MS);
            child.stderr.on('data', (data) => {
                stderr += data.toString();
                if (stderr.length >= STDERR_CAP || /FOAM (?:exiting|aborting)/.test(stderr)) {
                    finish();
                }
            });
            child.on('error', finish);
            child.on('close', finish);
        });
    }

    /*
        Async diagnostics: run the case's solver, parse every error and
        warning from stderr. Resolves to parallel arrays: uris[i] is the
        file diagnostics[i] belongs to.
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
        const stderr = await this.solverRunner(solver, root);
        const uris: TextDocumentIdentifier[] = [];
        const problems: Diagnostic[] = [];
        const errors = this.parseFoamErrors(stderr);
        for (const error of errors) {
            const severity = this.severityFor(error);
            if (severity === null) {
                continue;
            }
            problems.push(Diagnostic.create(
                Range.create(Math.max(error.start - 1, 0), 0, Math.max(error.end - 1, 0), 3),
                error.message,
                severity,
                error.errorType,
                `${of_fork}-${of_version}(${of_compile_option})`,
            ));
            uris.push({ uri: error.uri === undefined ? document.uri : error.uri });
        }
        return [uris, problems, errors];
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
    // Supported types of OpenFOAM errors
    private static foamProblems = {
        "FoamFatalError": "Generic OpenFOAM errors",
        "FoamFatalIOError": "Whatever the programmer deems as an IO problem",
    };

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
