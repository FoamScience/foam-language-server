/*
   Tools for parsing OpenFOAM case files
   Author: Mohammed Elwardi Fadeli
*/
'use strict';

import { DocumentUri, TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, Diagnostic, TextEdit, FormattingOptions, TextDocumentIdentifier } from 'vscode-languageserver-types';
import { Validator } from './foamValidator';
export type { SolverRunner } from './foamValidator';

import * as TreeParser from 'tree-sitter';

// The formatter is not used
export interface FormatterSettings extends FormattingOptions {
    ignoreMultilineInstructions?: boolean;
}

// Error codes to distinguish between different OpenFOAM errors
export enum ValidationCode {
    FOAM_FATAL_ERROR,
    FOAM_FATAL_IO_ERROR,
}

// How to respond to diagnostics
export enum ValidationSeverity {
    IGNORE,
    WARNING,
    ERROR
}

// A user-supplied parse rule for custom solver/utility output. pattern is
// a RegExp source, compiled with the 'gm' flags; its named capture groups
// feed the diagnostic: message, file (may carry OpenFOAM's dotted dict
// path suffix), line, endLine, options (whitespace-separated valid entries)
export interface CustomErrorRule {
    // shown as the diagnostic's code; defaults to "custom-rule"
    name?: string;
    pattern: string;
    severity?: 'error' | 'warning' | 'info' | 'hint';
}

// Validator configuration
export interface ValidatorSettings {
    // Root workspace directory
    rootUri: DocumentUri | null;

    // Setting for flagging FATAL ERRORs
    fatalError?: ValidationSeverity;

    // Setting for flagging FATAL IO ERRORs
    fatalIOError?: ValidationSeverity;

    // Setting for flagging FOAM Warnings
    warning?: ValidationSeverity;

    // Extra parse rules for custom solver/utility output
    customRules?: CustomErrorRule[];

    // Utilities (e.g. "checkMesh") to run besides the case's solver; they
    // run against a scratch copy of the case, never the user's files
    utilities?: string[];
}

// Async solver-based diagnostics for the case the document belongs to.
// solverRunner is test-only injection; production uses the real spawn-based one.
export function validateWithSolver(uri: DocumentUri, content: string, parser: TreeParser, settings?: ValidatorSettings, solverRunner?: import('./foamValidator').SolverRunner): Promise<[TextDocumentIdentifier[], Diagnostic[], import('./foamValidator').ParsedError[]]> {
    const document = TextDocument.create(uri, "foam", 0, content);
    const validator = new Validator(parser, settings, solverRunner);
    return validator.validateWithSolver(document);
}
