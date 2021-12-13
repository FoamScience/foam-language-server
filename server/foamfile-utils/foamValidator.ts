/*
    Validate OpenFOAM dictionaries and compute diagnostics
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Can run a solver and parse common error messages and valid entries

    Possible Improvements:
    - Support OF9 and if possible ESI version
*/

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Position, Range } from 'vscode-languageserver-types';
import { ValidationCode, ValidationSeverity, ValidatorSettings } from './main';

import { spawnSync, execSync } from 'child_process';
import { writeFile,readFileSync } from 'fs';
var path = require('path');

// OpenFOAM-related env vars
const of_fork = process.env.WM_PROJECT
const of_version = process.env.WM_PROJECT_VERSION
const of_compile_option = process.env.WM_COMPILE_OPTION
const usr_libs = process.env.FOAM_USER_LIBBIN
const usr_bins = process.env.FOAM_USER_APPBIN

// Parser object, this parser is not fault-tolerant
const parser = require('bindings')('foamParser');
const fp = new parser.foamParser();

// A representation of an OpenFOAM error
export class ParsedError {
     public errorType: string;
     public message: string;
     public start: number;
     public end: number;
     public options: string[];
}

export class Validator {

    private document: TextDocument;

    private settings: ValidatorSettings = {
        rootUri: null,
        fatalError: ValidationSeverity.ERROR,
        fatalIOError: ValidationSeverity.WARNING,
    }

    constructor(settings?: ValidatorSettings) {
        if (settings) {
            this.settings = settings;
        }
    }

    /*
        Parses an OpenFOAM case dictionary
        Takes:
        - The content of the dictionary
        Returns:
        - Error type
        - The error message
        - Start position
        - End position
        - Valid entries (optional) for completion
    */
    parseFoamError(text: string) {

        const result = new ParsedError();

        // Prepare text string (what's in stderr)
        text = text.replace(/\r?\n/g, " ").replace(/\s+/, " ")

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
            //return [
            //    errType.toString(),         // Type
            //    message.toString(),         // Message
            //    positions[0].toString(),    // Starting line
            //    positions[1].toString(),    // Ending line
            //    options                     // No valid options
            //];
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
            errorType: "",
            message: "",
            start: 0,
            end: 0,
            options: []
        };
    }

    // Run the solver
    private runSolver() {
        const controlDict : string = readFileSync(path.join(this.settings.rootUri.replace("file://",''), 'system/controlDict'), 'ascii');
        let solver = fp.getEntryValue("application", controlDict);

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
    validate(document: TextDocument): Diagnostic[] {
        this.document = document;
        let problems: Diagnostic[] = [];

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
        } catch {
            // TODO: If can't get diagnostics, say so
            console.warn("Could not get diagnostics...");
        }

        return problems;
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
