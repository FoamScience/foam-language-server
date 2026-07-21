/*
    Provide unformatted docs to various OpenFOAM keywords, snippets and
    signature help
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Only examples of keyword and snippet documentation are provided
    - Only examples of signature help documentation are provided

    Possible Improvements:
    - Extensive coverage of common OpenFOAM keywords with signature help
*/
'use strict';

import { MarkupContent, MarkupKind } from "vscode-languageserver";
import { KEYWORD_DB, runtimeDoc } from './foam';

export class PlainTextDocumentation {

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
                    "type fixedValue;\n" +
                    "type wall;"
                    // Can also include online docs
                    //+this.formatMessage(this.foamMessages["footer"], "https://link")
            },

            value: {
                contents: this.foamMessages["value"] +
                    "value uniform 0;\n" +
                    "value nonuniform List<scalar> 3(0 2 1);"
            },

            boundaryCondition: {
                contents: this.foamMessages["boundaryCondition"] +
                    "inlet {\n" +
                    "   type fixedValue;\n" +
                    "   value uniform 1;\n" +
                    "}"
            },

            include: {
                contents: this.foamMessages["include"] +
                    "#include \"functionCfg\""
            },

            // Signature helps

            signature_type: {
                contents: "type <boundaryCondition:word>;\n" +
                    "type <patch:word>;\n" +
                    "type <rheologyMode:word>;"
            },

            signature_param_type: {
                contents: "A word (usually)\n"
            },

        };

        // keywords.json is the source of truth; hand-written entries above win
        for (const object of Object.keys(KEYWORD_DB)) {
            for (const keyword of Object.keys(KEYWORD_DB[object])) {
                if (this.markdowns[keyword] !== undefined) {
                    continue;
                }
                const entry = KEYWORD_DB[object][keyword];
                let contents = (entry.doc ?? "") + "\n";
                if (entry.examples) {
                    contents += "\n" + entry.examples;
                }
                if (entry.values) {
                    contents += "\n\nValid values: " + entry.values.join(", ");
                }
                this.markdowns[keyword] = { contents };
            }
        }
    }

    // Plain-text docs for runtime-selectable class names (issue #15),
    // looked up on demand — not merged into this.markdowns
    private runtimePlain(word: string): string | undefined {
        const entries = runtimeDoc(word);
        if (!entries) {
            return undefined;
        }
        return entries
            .map(e => (e.class ?? word) + (e.doc ? ": " + e.doc : ""))
            .join("\n");
    }

    /*
        Returns docs for a keyword as plain text
    */
    getDocumentation(data: string): string {
        return this.markdowns[data] ?? this.runtimePlain(data);
    }

    /*
        Returns signature help for a keyword as plain text
    */
    getSignatureHelp(data: string): string {
        if (this.markdowns[data] === undefined) return '';
        return this.markdowns[data].contents.toString();
    }

    /*
        Returns signature help for a keyword as plain text
    */
    getCompletionDocs(data: string): MarkupContent {
        if (this.markdowns[data] === undefined) return {
            kind: MarkupKind.PlainText,
            value: this.runtimePlain(data) ?? ''
        };
        return {
            kind: MarkupKind.PlainText,
            value: this.markdowns[data].contents.toString()
        };
    }
}
