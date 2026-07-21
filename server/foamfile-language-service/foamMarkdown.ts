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
import { KEYWORD_DB, RUNTIME_META, runtimeDoc } from './foam';

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

        // keywords.json is the source of truth; hand-written entries above win
        for (const object of Object.keys(KEYWORD_DB)) {
            for (const keyword of Object.keys(KEYWORD_DB[object])) {
                if (this.markdowns[keyword] !== undefined) {
                    continue;
                }
                const entry = KEYWORD_DB[object][keyword];
                let contents = (entry.doc ?? "") + "\n";
                if (entry.examples) {
                    contents += "\n```\n" + entry.examples + "\n```";
                }
                if (entry.values) {
                    contents += "\n\nValid values: `" + entry.values.join("`, `") + "`";
                }
                this.markdowns[keyword] = { contents };
            }
        }
    }

    // Will be used to get online Docs if any
    //private formatMessage(text: string, variable: string): string {
    //    return text.replace("${0}", variable);
    //}

    // Docs for runtime-selectable class names (issue #15), looked up on
    // demand — deliberately NOT merged into this.markdowns, which is
    // rebuilt on every construction.
    private runtimeMarkdown(word: string): string | undefined {
        const entries = runtimeDoc(word);
        if (!entries) {
            return undefined;
        }
        const parts = entries.map(e => {
            let text = "**`" + (e.class ?? word) + "`**";
            if (e.doc) {
                text += " — " + e.doc;
            }
            if (e.src) {
                text += "\n\n*" + e.src + "*";
            }
            return text;
        });
        return parts.join("\n\n---\n\n")
            + "\n\n*from OpenFOAM sources (" + RUNTIME_META.source + ")*";
    }

    /*
        Returns docs for a keyword in markdown format
    */
    public getMarkdown(word: string): Hover {
        if (this.markdowns[word] !== undefined) {
            return this.markdowns[word];
        }
        const runtime = this.runtimeMarkdown(word);
        return runtime === undefined ? undefined : { contents: runtime };
    }

    /*
        Returns signature help for a keyword as plain text
    */
    getCompletionDocs(data: string): MarkupContent {
        if (this.markdowns[data] === undefined) {
            return {
                kind: MarkupKind.Markdown,
                value: this.runtimeMarkdown(data) ?? ''
            };
        }
        return {
            kind: MarkupKind.Markdown,
            value: this.markdowns[data].contents.toString()
        };
    }
}
