/*
    Parsing OpenFOAM files using Tree-Sitter grammer for OpenFOAM
    https://github.com/FoamScience/tree-sitter-foam
    Author: Mohammed Elwardi Fadeli

    Does initialization work for the parser
*/

import * as Parser from 'tree-sitter'
import * as FoamLanguage from 'tree-sitter-foam'

// This function is useful for testing things with the tree parser :)
export function getParser() : Parser {
    const parser = new Parser();
    parser.setLanguage(FoamLanguage);
    return parser;
}

