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

import * as TreeParser from 'web-tree-sitter';

import { spawnSync, execSync } from 'child_process';
import { writeFile,readFileSync } from 'fs';
var path = require('path');

// Try to figure out OpenFOAM-related env vars
const of_fork = process.env.WM_PROJECT
const of_version = process.env.WM_PROJECT_VERSION
const of_compile_option = process.env.WM_COMPILE_OPTION
const usr_libs = process.env.FOAM_USER_LIBBIN
const usr_bins = process.env.FOAM_USER_APPBIN

// A representation of an OpenFOAM error
export class ParsedError {
    uri: DocumentUri;
    errorType: string;
    message: string;
    start: number;
    end: number;
    options: string[];
}

export class Validator {

    private document: TextDocument;
    // A local reference to the Tree-Sitter Parser
    private treeParser : TreeParser;


    private settings: ValidatorSettings = {
        rootUri: null,
        fatalError: ValidationSeverity.ERROR,
        fatalIOError: ValidationSeverity.WARNING,
    }

    constructor(parser : TreeParser, settings?: ValidatorSettings) {
        if (settings) {
            this.settings = settings;
        }
        this.treeParser = parser;
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
            let node = cursor.currentNode();
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
    // Run the solver
    private runSolver() {
        const controlDict : string = readFileSync(path.join(this.settings.rootUri.replace("file://",''), 'system/controlDict'), 'ascii');
        let solver : string;
        for (const entry of this.getKeywordValue(controlDict, "application")) {
            // Last one wins
            solver = entry;
        }

        var results: ParsedError;// = ["", "", "", "", []];

        // with spawn, maxBuffer restricts both stderr and stdout
        // we're interested in limiting stdout without trimming stderr
        // TODO: Make sure 2048 bytes is enough to capture all OpenFOAM errors
        let res = spawnSync
        (
            solver,
            { maxBuffer: 2048, encoding: 'utf-8', cwd: this.settings.rootUri.replace("file://", '') }
        );
        results = this.parseFoamError(res.stderr.toString().replace(/\r?\n/g," ").replace(/\s+/g, " ").toString())

        // with exec
        //try {
        //    // Run solver, if it works kill it after writing 4096 bytes
        //    let res = execSync
        //    (
        //        solver,
        //        { maxBuffer: 4096, timeout:500, encoding: 'utf-8' }
        //    );
        //    return ["", "", "", "", []];
        //} catch (err)
        //{
        //    // If it errors out (hopefully), parse error
        //    return this.parseFoamError(err.stderr.replace(/\r?\n/g," ").replace(/\s+/g, " ").toString())
        //}
        return results;
    }

    /*
       Compute diagnostics
    */
    validate(document: TextDocument): [TextDocumentIdentifier[], Diagnostic[]] {
        this.document = document;
        let problems: Diagnostic[] = [];
        let uris: TextDocumentIdentifier[] = [];

        try {
            const result = this.runSolver();

            var pos1: number = result.start-1;
            var pos2: number = result.end-1;
            const problem = Diagnostic.create(
                Range.create(pos1,0,pos2,3),
                result.message.toString(),
                DiagnosticSeverity.Error,
                result.errorType.toString(),
                `${of_fork}-${of_version}(${of_compile_option})`,
            );
            problems.push(problem);
            // For URIs, falling back to current file if parsing the error text
            // didn't reveal a file
            uris.push({ uri: (result.uri === undefined ? document.uri : result.uri ) })
        } catch {
            // If can't get diagnostics, just stay silent
            //console.warn("Could not get diagnostics...");
        }

        return [uris, problems];
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
