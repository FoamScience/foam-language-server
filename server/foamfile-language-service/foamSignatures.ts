/*
    Signatures for keywords/SubDicts inside OpenFOAM dictionaries
    The actual signature contents are stored in PlainTextDocumentation
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Support for key-value signatures

    Possible Improvements:
    - Add more keyword/dictionary signatures
*/
import {
    TextDocument, Position, SignatureHelp, SignatureInformation
} from 'vscode-languageserver-types';
import { PlainTextDocumentation } from './foamPlainText';
import { FoamHover } from './foamHover';

import * as TreeParser from 'web-tree-sitter';

export class FoamSignatures {

    private documentation = new PlainTextDocumentation();
    private treeParser : TreeParser;
    private hover : FoamHover;

    // Constructor
    constructor(parser : TreeParser) {
        this.treeParser = parser;
        this.hover = new FoamHover(null, this.documentation, this.treeParser);
    }

    public computeSignatures(content: string, position: Position): SignatureHelp {
        const signatureLabel = this.hover.getNodeUnderCursor(content, position).text;
        let signatureDoc: string = this.documentation.getSignatureHelp("signature_"+signatureLabel);
        let signatureParamDoc: string = this.documentation.getSignatureHelp("signature_param_"+signatureLabel);
        return {
                    signatures: [
                        {
                            label: "Keyword: "+signatureLabel,
                            documentation: signatureDoc,
                            parameters: []
                            // TODO: Support documentation for keyword parameters??
                        }
                    ],
                    activeSignature: 0,
                    activeParameter: 0
        }
    }
}
