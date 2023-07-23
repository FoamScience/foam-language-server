/*
    Abstracts analyzing and resolving completion items
    Most of the actual derivation of completion items is done in FoamAssist
    Author: Mohammed Elwardi Fadeli

    Current Status:
    - Automatic fetching of Markdown/Plain documentation for keywords and directives
*/
'use strict';

import { CompletionItem, MarkupKind } from 'vscode-languageserver-types';
import { MarkdownDocumentation } from './foamMarkdown';
import { PlainTextDocumentation } from './foamPlainText';

export class FoamCompletion {

    private foamMarkdown = new MarkdownDocumentation();
    private foamPlainText = new PlainTextDocumentation();

    // Document the completion item if available
    public resolveCompletionItem(item: CompletionItem, documentationFormat?: MarkupKind[]): CompletionItem {

        // If no docs kind provided, select PlainText
        if (documentationFormat === undefined || documentationFormat === null)
        {
            documentationFormat = [MarkupKind.PlainText];
        }
        if (!item.documentation)
        {
            for (let format of documentationFormat) {
                if (format === MarkupKind.PlainText) {
                    item.documentation = this.foamPlainText.getCompletionDocs(item.data.toString());
                    return item;
                } else if (format === MarkupKind.Markdown) {
                    item.documentation = this.foamMarkdown.getCompletionDocs(item.data.toString());
                    return item;
                }
            }
            // no known format detected, just use plain text then
            item.documentation = this.foamPlainText.getCompletionDocs(item.data.toString());
        }
    }
}
