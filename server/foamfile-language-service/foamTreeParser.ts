/*
    Parsing OpenFOAM files using Tree-Sitter grammer for OpenFOAM
    https://github.com/FoamScience/tree-sitter-foam
    Author: Mohammed Elwardi Fadeli

    Does initialization work for the parser
*/

//import * as Parser from 'web-tree-sitter';
import * as Parser from 'tree-sitter'
const Lang = require('tree-sitter-foam')

// This function is useful for testing things with the tree parser :)
export async function getParser() : Promise<Parser> {
    //await Parser.init();
    const parser = new Parser();
    //const Lang = await Parser.Language.load(`${__dirname}/../../languages/foam.wasm`);
    parser.setLanguage(Lang);
    return parser;
}

