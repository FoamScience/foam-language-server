/*
    Hover information for OpenFOAM keywords
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Support for hovering over keywords

    Possible Improvements:
    - Support online links to keywords
*/
'use strict';

import { TextDocument, Hover, Position, MarkupKind } from 'vscode-languageserver-types';
import { MarkdownDocumentation } from './foamMarkdown';
import { PlainTextDocumentation } from './foamPlainText';

import * as TreeParser from 'tree-sitter';

export class FoamHover {

    // A local reference to the Tree-Sitter Parser
    private treeParser : TreeParser;
    private markdown: MarkdownDocumentation;
    private plainText: PlainTextDocumentation;

    constructor(markdown: MarkdownDocumentation, plainText: PlainTextDocumentation, parser: TreeParser) {
        this.treeParser = parser;
        this.markdown = markdown;
        this.plainText = plainText;
    }

    // Returns the node at current position
    public getNodeUnderCursor(content: string, position: Position) {
        let document : TextDocument = TextDocument.create("", "foam", 0, content);
        let offset = document.offsetAt(position)
        const tree = this.treeParser.parse(content);

        // Start from root
        let root = tree.rootNode;
        let closestNode = root;
        let nodeNotFound = true;
        while (nodeNotFound) {
            for (let child of root.children) {
                if (
                    (Math.abs(offset - child.startIndex) <= Math.abs(offset - closestNode.startIndex))
                    && (offset >= child.startIndex)
                )
                {
                    closestNode = child;
                }
            }
            if (root == closestNode)
            {
                nodeNotFound = false;
            }
            root = closestNode;
        }
        return root;
    }

    // What happens the hover event is triggered
    public onHover(content: string, position: Position, markupKind: MarkupKind[]): Hover | null {

        const key = this.getNodeUnderCursor(content, position).text;
        if (key) {
            // if it's not a raw value, fetch documenation
            if (markupKind && markupKind.length > 0) {
                switch (markupKind[0]) {
                    case MarkupKind.Markdown:
                        let markdownDocumentation = this.markdown.getMarkdown(key);
                        if (markdownDocumentation) {
                            return {
                                contents: {
                                    kind: MarkupKind.Markdown,
                                    value: markdownDocumentation.contents as string
                                }
                            };
                        }
                        return null;
                    case MarkupKind.PlainText:
                        let plainTextDocumentation = this.plainText.getDocumentation(key);
                        if (plainTextDocumentation) {
                            return {
                                contents: {
                                    kind: MarkupKind.PlainText,
                                    value: plainTextDocumentation
                                }
                            };
                        }
                }
                return null;
            }
            const hover = this.markdown.getMarkdown(key);
            return hover === undefined ? null : hover;
        }
        return null;
    }
}
