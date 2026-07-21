/*
    Signatures for keywords/SubDicts inside OpenFOAM dictionaries
    The actual signature contents are stored in PlainTextDocumentation and KEYWORD_DB
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Support for key-value signatures from PlainTextDocumentation (legacy)
    - Support for keyword database-backed signatures with values

    Possible Improvements:
    - Add more keyword/dictionary signatures
*/
import {
    TextDocument, Position, SignatureHelp, SignatureInformation, ParameterInformation
} from 'vscode-languageserver-types';
import { PlainTextDocumentation } from './foamPlainText';
import { FoamHover } from './foamHover';
import { KEYWORD_DB, keywordsFor, KeywordEntry } from './foam';

import * as TreeParser from 'tree-sitter';

export class FoamSignatures {

    private documentation = new PlainTextDocumentation();
    private treeParser : TreeParser;
    private hover : FoamHover;

    // Constructor
    constructor(parser : TreeParser) {
        this.treeParser = parser;
        this.hover = new FoamHover(null, this.documentation, this.treeParser);
    }

    public computeSignatures(content: string, position: Position, parsedTree?: TreeParser.Tree): SignatureHelp {
        const signatureLabel = this.hover.getNodeUnderCursor(content, position, parsedTree).text;

        // Legacy fallback: check PlainTextDocumentation first (for hand-written entries like "type")
        let signatureDoc: string = this.documentation.getSignatureHelp("signature_"+signatureLabel);
        let parameters: ParameterInformation[] = [];

        if (signatureDoc === '') {
            // Not in legacy documentation, try keyword database
            const entry = this.lookupKeywordEntry(signatureLabel);
            if (entry) {
                signatureDoc = entry.doc ?? '';
                if (entry.values) {
                    signatureDoc += '\nValid values: ' + entry.values.join(', ');
                    // ponytail: no file-kind scoping (signatures don't know FoamFile object without plumbing; fine for now)
                    parameters = entry.values.map(value => ({
                        label: value
                    }));
                }
                if (entry.examples) {
                    signatureDoc += '\n\n' + entry.examples;
                }
            }
        }

        return {
                    signatures: [
                        {
                            label: "Keyword: "+signatureLabel,
                            documentation: signatureDoc,
                            parameters: parameters,
                            activeParameter: parameters.length > 0 ? 0 : undefined
                        }
                    ],
                    activeSignature: 0,
                    activeParameter: 0
        }
    }

    private lookupKeywordEntry(keyword: string): KeywordEntry | undefined {
        // Try universal keywords first
        if (KEYWORD_DB['*'] && KEYWORD_DB['*'][keyword]) {
            return KEYWORD_DB['*'][keyword];
        }

        // Then try other sections
        for (const section of Object.keys(KEYWORD_DB)) {
            if (section !== '*' && KEYWORD_DB[section][keyword]) {
                return KEYWORD_DB[section][keyword];
            }
        }

        return undefined;
    }
}
