/*
    Active banana trick: deliberately provoke the case's solver into
    revealing a keyword's valid options by substituting its value with a
    nonsense token ("banana") and parsing the resulting error.

    Runs entirely against a scratch copy of the case under os.tmpdir() —
    the user's own case files are never written to.

    All filesystem work is async on purpose: probe() is kicked off (fire
    and forget) from the completion handler, so nothing here may block the
    event loop while a completion response is being computed (issue #9).
*/
'use strict';

import { promises as fsp } from 'fs';
import * as os from 'os';
import * as TreeParser from 'tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Validator, SolverRunner } from '../foamfile-utils/foamValidator';
import { ValidatorSettings } from '../foamfile-utils/main';
import { copyCaseSkeleton } from '../foamfile-utils/scratchCase';
import { FoamWorkspaceIndex } from './foamWorkspaceIndex';
import { findDictPath } from './foamCase';
const path = require('path');

export class FoamBananaTrick {

    private parser: TreeParser;
    private solverRunner?: SolverRunner;
    // the user's diagnostics settings, so custom "Valid options" rules
    // feed completion exactly like they feed diagnostics
    private settings?: ValidatorSettings;

    constructor(parser: TreeParser, solverRunner?: SolverRunner, settings?: ValidatorSettings) {
        this.parser = parser;
        this.solverRunner = solverRunner;
        this.settings = settings;
    }

    /*
        Probes the case's solver for the valid values of the keyword at the
        end of dictPath (e.g. ["ddtSchemes", "default"]) in the file at uri.
        Best-effort: failing to locate the case, the file or the value node
        resolves to an empty list rather than throwing. The scratch dir is
        always removed, even on failure.
    */
    public async probe(uri: string, dictPath: string[], index: FoamWorkspaceIndex): Promise<string[]> {
        const root = index.getRootPath();
        const file = index.getFile(uri);
        if (!root || !file) {
            return [];
        }
        const bananaContent = this.spliceBanana(file.tree.rootNode, file.content, dictPath);
        if (bananaContent === null) {
            return [];
        }
        const relPath = path.relative(root, uri.replace(/^file:\/\//, ''));
        if (relPath.startsWith('..')) {
            return [];
        }

        const scratchDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'foam-banana-'));
        try {
            await copyCaseSkeleton(root, scratchDir);

            const scratchFile = path.join(scratchDir, relPath);
            await fsp.mkdir(path.dirname(scratchFile), { recursive: true });
            await fsp.writeFile(scratchFile, bananaContent);

            // probes only ever run the solver: utilities would multiply
            // process spawns without ever printing a "Valid options" list
            const validator = new Validator(this.parser,
                { ...(this.settings ?? {}), rootUri: 'file://' + scratchDir, utilities: undefined },
                this.solverRunner);
            const document = TextDocument.create('file://' + scratchFile, 'foam', 0, bananaContent);
            const [, , errors] = await validator.validateWithSolver(document);
            for (const error of errors) {
                if (error.options && error.options.length > 0) {
                    return error.options;
                }
            }
            return [];
        } finally {
            await fsp.rm(scratchDir, { recursive: true, force: true });
        }
    }

    /*
        What the scratch copy of the probed file should contain. Three
        shapes, by what the saved file holds for dictPath's last segment:
        - a value: overwrite it with "banana" (the classic trick)
        - the bare keyword, no value: overwrite the entry with a complete
          "<keyword> banana;"
        - nothing at all (the user is still typing the keyword): append
          "<keyword> banana;" to the enclosing dict
        The mutation only ever lands in the scratch copy, so it can always
        be a well-formed entry — no "when to add ;" dilemma (issue #3).
        null when even the enclosing dict is missing from the saved file.
    */
    private spliceBanana(root: TreeParser.SyntaxNode, content: string, dictPath: string[]): string | null {
        const node = findDictPath(root, dictPath);
        const entry = `${dictPath[dictPath.length - 1]} banana;`;
        if (node && node.type !== 'key_value') {
            return content.slice(0, node.startIndex) + 'banana' + content.slice(node.endIndex);
        }
        if (node) {
            // findDictPath handed back the key_value itself: no value node
            return content.slice(0, node.startIndex) + entry + content.slice(node.endIndex);
        }
        let insertAt = content.length;
        if (dictPath.length > 1) {
            const dict = findDictPath(root, dictPath.slice(0, -1));
            if (!dict) {
                return null;
            }
            // insert at the end of the dict's entry list, before its '}'
            const cores = dict.type === 'dict'
                ? dict.namedChildren.filter(c => c.type === 'dict_core')
                : [dict];
            insertAt = cores.length > 0 ? cores[cores.length - 1].endIndex : dict.endIndex - 1;
        }
        return content.slice(0, insertAt) + '\n' + entry + '\n' + content.slice(insertAt);
    }
}
