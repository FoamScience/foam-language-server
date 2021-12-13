/*
    Provide docs to various OpenFOAM keywords, snippets and signature
    help formatted as Markdown
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Only examples of keyword and snippet documentation are provided

    Possible Improvements:
    - Extensive coverage of common OpenFOAM keywords
*/
'use strict';

import { MarkupContent, MarkupKind } from "vscode-languageserver";
import { Hover } from 'vscode-languageserver-types';

export class MarkdownDocumentation {

    private foamMessages = {
        "type": "Choose the type of the object.\n\n",
        "value": "Choose the value assigned to the object.\n\n",
        "boundaryCondition": "Handle a boundary patch for this field.\n\n",
        "include": "Include OpenFOAM dictionaries here.\n\n",
    };

    private markdowns: any;

    constructor() {
        this.markdowns = {
            type: {
                contents: this.foamMessages["type"] +
                    "```\n" +
                    "type fixedValue;\n" +
                    "type wall;\n" +
                    "```"
                    // Can also include online docs
                    //+this.formatMessage(this.foamMessages["footer"], "https://link")
            },

            value: {
                contents: this.foamMessages["value"] +
                    "```\n" +
                    "value uniform 0;\n" +
                    "value nonuniform List<scalar> 3(0 2 1);\n" +
                    "```"
            },

            boundaryCondition: {
                contents: this.foamMessages["boundaryCondition"] +
                    "```\n" +
                    "inlet {\n" +
                    "   type fixedValue;\n" +
                    "   value uniform 1;\n" +
                    "}\n" +
                    "```"
            },

            include: {
                contents: this.foamMessages["include"] +
                    "```\n" +
                    "#include \"functionCfg\"\n" +
                    "```"
            }
        };
    }

    // Will be used to get online Docs if any
    //private formatMessage(text: string, variable: string): string {
    //    return text.replace("${0}", variable);
    //}

    /*
        Returns docs for a keyword in markdown format
    */
    public getMarkdown(word: string): Hover {
        return this.markdowns[word];
    }

    /*
        Returns signature help for a keyword as plain text
    */
    getCompletionDocs(data: string): MarkupContent {
        if (this.markdowns[data] === undefined) return {
            kind: MarkupKind.Markdown,
            value: ''
        };
        return {
            kind: MarkupKind.Markdown,
            value: this.markdowns[data].contents.toString()
        };
    }
}
