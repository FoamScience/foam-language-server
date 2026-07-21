/*
    Inlay hints for OpenFOAM dimension sets: renders a human-readable
    unit (e.g. "m²/s", "kg/(m·s²) (Pa)") after the closing `]` of a
    `dimensions [...]` entry or an inline dimensioned scalar
    (`nu nu [0 2 -1 0 0 0 0] 0.01;`).
*/
'use strict';

import { InlayHint, InlayHintKind, Position, Range } from 'vscode-languageserver-types';
import * as TreeParser from 'tree-sitter';

// grammar order: kg m s K mol A cd
const BASE_UNITS = ['kg', 'm', 's', 'K', 'mol', 'A', 'cd'];

// exponent tuple (kg,m,s,K,mol,A,cd) -> well-known named unit, appended in parens
const NAMED_UNITS: [number[], string][] = [
    [[1, -1, -2, 0, 0, 0, 0], 'Pa'],       // pressure/stress
    [[1, 1, -2, 0, 0, 0, 0], 'N'],         // force
    [[1, 2, -2, 0, 0, 0, 0], 'J'],         // energy
    [[1, 2, -3, 0, 0, 0, 0], 'W'],         // power
    [[0, 0, -1, 0, 0, 0, 0], 'Hz'],        // frequency
    [[1, -1, -1, 0, 0, 0, 0], 'Pa·s'], // dynamic viscosity
    [[1, 2, -3, 0, 0, -1, 0], 'V'],        // electric potential
    [[0, 0, 1, 0, 0, 1, 0], 'C'],          // electric charge
];

const SUPERSCRIPT_DIGITS: { [digit: string]: string } = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

function toSuperscript(n: number): string {
    const sign = n < 0 ? '⁻' : '';
    return sign + String(Math.abs(n)).split('').map(d => SUPERSCRIPT_DIGITS[d]).join('');
}

function exponentSuffix(exp: number): string {
    const abs = Math.abs(exp);
    if (abs === 1) {
        return '';
    }
    return abs <= 3 ? toSuperscript(abs) : ('^' + abs);
}

function namedUnitFor(exponents: number[]): string | undefined {
    for (const [tuple, name] of NAMED_UNITS) {
        if (tuple.every((v, i) => v === exponents[i])) {
            return name;
        }
    }
    return undefined;
}

function formatUnit(exponents: number[]): string {
    if (exponents.every(exp => exp === 0)) {
        return 'dimensionless';
    }
    const numerator: string[] = [];
    const denominator: string[] = [];
    exponents.forEach((exp, i) => {
        if (exp > 0) {
            numerator.push(BASE_UNITS[i] + exponentSuffix(exp));
        } else if (exp < 0) {
            denominator.push(BASE_UNITS[i] + exponentSuffix(exp));
        }
    });
    let unit: string;
    if (denominator.length === 0) {
        unit = numerator.join('·');
    } else {
        const denominatorStr = denominator.length > 1
            ? `(${denominator.join('·')})`
            : denominator[0];
        unit = (numerator.length > 0 ? numerator.join('·') : '1') + '/' + denominatorStr;
    }
    const named = namedUnitFor(exponents);
    return named ? `${unit} (${named})` : unit;
}

function exponentBreakdown(exponents: number[]): string {
    return BASE_UNITS.map((name, i) => `${name}^${exponents[i]}`).join(' ');
}

function isWithinRange(position: Position, range: Range): boolean {
    const afterStart = position.line > range.start.line
        || (position.line === range.start.line && position.character >= range.start.character);
    const beforeEnd = position.line < range.end.line
        || (position.line === range.end.line && position.character <= range.end.character);
    return afterStart && beforeEnd;
}

export class FoamInlayHints {

    private treeParser: TreeParser;

    constructor(parser?: TreeParser) {
        this.treeParser = parser;
    }

    public computeInlayHints(content: string, range: Range, parsedTree?: TreeParser.Tree): InlayHint[] {
        if (!this.treeParser && !parsedTree) {
            return [];
        }
        const tree = parsedTree ?? this.treeParser.parse(content);
        const hints: InlayHint[] = [];
        const visit = (node: TreeParser.SyntaxNode) => {
            if (node.type === 'dimensions') {
                const hint = this.buildHint(node, range);
                if (hint) {
                    hints.push(hint);
                }
                return;
            }
            for (const child of node.namedChildren) {
                visit(child);
            }
        };
        visit(tree.rootNode);
        return hints;
    }

    private buildHint(node: TreeParser.SyntaxNode, range: Range): InlayHint | null {
        // ponytail: only the current 7-base-unit (kg m s K mol A cd) dimension
        // sets are labeled; the pre-1.6 5-element form parses fine too but its
        // base-unit order isn't nailed down here, add a table if it comes up
        const exponents = node.namedChildren
            .filter(child => child.type === 'number_literal')
            .map(child => parseFloat(child.text));
        if (exponents.length !== 7 || exponents.some(exp => !Number.isInteger(exp))) {
            return null;
        }
        const position: Position = { line: node.endPosition.row, character: node.endPosition.column };
        if (!isWithinRange(position, range)) {
            return null;
        }
        return {
            position,
            label: formatUnit(exponents),
            kind: InlayHintKind.Type,
            paddingLeft: true,
            tooltip: exponentBreakdown(exponents),
        };
    }
}
