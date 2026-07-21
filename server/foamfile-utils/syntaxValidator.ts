/*
    Instant syntax diagnostics from the tree-sitter tree:
    ERROR nodes and missing (inserted-by-recovery) nodes.
    No solver involved, cheap enough to run on every keystroke.
*/
'use strict';

import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver-types';
import * as TreeParser from 'tree-sitter';

const SOURCE = "tree-sitter-foam";

export class SyntaxValidator {

    public validate(tree: TreeParser.Tree): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        if (tree.rootNode.hasError) {
            this.collect(tree.rootNode, diagnostics);
        }
        return diagnostics;
    }

    private nodeRange(node: TreeParser.SyntaxNode): Range {
        return Range.create(
            node.startPosition.row, node.startPosition.column,
            node.endPosition.row, node.endPosition.column);
    }

    // Report leaf-most ERROR nodes (most precise ranges) and missing nodes.
    // Returns whether anything was reported for this subtree.
    private collect(node: TreeParser.SyntaxNode, diagnostics: Diagnostic[]): boolean {
        if (node.isMissing) {
            diagnostics.push(Diagnostic.create(
                this.nodeRange(node),
                `Syntax error: missing "${node.type}"`,
                DiagnosticSeverity.Error,
                "SYNTAX_ERROR",
                SOURCE));
            return true;
        }
        let reportedInSubtree = false;
        for (const child of node.children) {
            if (child.hasError || child.isMissing) {
                reportedInSubtree = this.collect(child, diagnostics) || reportedInSubtree;
            }
        }
        if (node.type === 'ERROR' && !reportedInSubtree) {
            const snippet = node.text.length > 30 ? node.text.slice(0, 30) + "…" : node.text;
            diagnostics.push(Diagnostic.create(
                this.nodeRange(node),
                `Syntax error near "${snippet}"`,
                DiagnosticSeverity.Error,
                "SYNTAX_ERROR",
                SOURCE));
            return true;
        }
        return reportedInSubtree;
    }
}
