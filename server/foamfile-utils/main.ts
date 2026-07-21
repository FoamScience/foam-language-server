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

// Validator configuration
export interface ValidatorSettings {
    // Root workspace directory
    rootUri: DocumentUri | null;

    // Setting for flagging FATAL ERRORs
    fatalError?: ValidationSeverity;

    // Setting for flagging FATAL IO ERRORs
    fatalIOError?: ValidationSeverity;
}

// Validates the whole workspace (case)
// and returns the resulting array of diagnostics with corresponding URIs
export function validate(content: string, parser: TreeParser, settings?: ValidatorSettings, tree?: TreeParser.Tree): [TextDocumentIdentifier[], Diagnostic[]] {
    const document = TextDocument.create("", "", 0, content);
    const validator = new Validator(parser, settings);
    return validator.validate(document);
}

// Async solver-based diagnostics for the case the document belongs to
export function validateWithSolver(uri: DocumentUri, content: string, parser: TreeParser, settings?: ValidatorSettings): Promise<[TextDocumentIdentifier[], Diagnostic[], import('./foamValidator').ParsedError[]]> {
    const document = TextDocument.create(uri, "foam", 0, content);
    const validator = new Validator(parser, settings);
    return validator.validateWithSolver(document);
}
