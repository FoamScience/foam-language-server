/*
    Active banana trick: deliberately provoke the case's solver into
    revealing a keyword's valid options by substituting its value with a
    nonsense token ("banana") and parsing the resulting error.

    Runs entirely against a scratch copy of the case under os.tmpdir() —
    the user's own case files are never written to.
*/
'use strict';

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as TreeParser from 'tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Validator, SolverRunner } from '../foamfile-utils/foamValidator';
import { FoamWorkspaceIndex } from './foamWorkspaceIndex';
import { findDictPath } from './foamCase';
const path = require('path');

// case sub-trees worth copying into the scratch probe dir, mirroring
// FoamWorkspaceIndex's walk/skip rules
const MAX_FILE_SIZE = 1024 * 1024;
const SKIPPED_DIRS = new Set(['postProcessing', 'dynamicCode', 'polyMesh.bak', 'VTK']);
const INDEXED_TOPDIRS = /^(0.*|constant|system)$/;

export class FoamBananaTrick {

    private parser: TreeParser;
    private solverRunner?: SolverRunner;

    constructor(parser: TreeParser, solverRunner?: SolverRunner) {
        this.parser = parser;
        this.solverRunner = solverRunner;
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
        const valueNode = findDictPath(file.tree.rootNode, dictPath);
        if (!valueNode) {
            return [];
        }
        const relPath = path.relative(root, uri.replace(/^file:\/\//, ''));
        if (relPath.startsWith('..')) {
            return [];
        }

        const scratchDir = mkdtempSync(path.join(os.tmpdir(), 'foam-banana-'));
        try {
            this.copyCaseSkeleton(root, scratchDir);

            const bananaContent = file.content.slice(0, valueNode.startIndex)
                + 'banana'
                + file.content.slice(valueNode.endIndex);
            const scratchFile = path.join(scratchDir, relPath);
            mkdirSync(path.dirname(scratchFile), { recursive: true });
            writeFileSync(scratchFile, bananaContent);

            const validator = new Validator(this.parser, { rootUri: 'file://' + scratchDir }, this.solverRunner);
            const document = TextDocument.create('file://' + scratchFile, 'foam', 0, bananaContent);
            const [, , errors] = await validator.validateWithSolver(document);
            for (const error of errors) {
                if (error.options && error.options.length > 0) {
                    return error.options;
                }
            }
            return [];
        } finally {
            rmSync(scratchDir, { recursive: true, force: true });
        }
    }

    // ponytail: binary files (e.g. binary-format mesh geometry) are skipped
    // wholesale rather than copied verbatim, so probes against binary-mesh
    // cases degrade to no options; copy raw bytes instead if that bites
    private copyCaseSkeleton(root: string, dest: string): void {
        let names: string[];
        try {
            names = readdirSync(root);
        } catch {
            return;
        }
        for (const name of names) {
            if (INDEXED_TOPDIRS.test(name) && !name.startsWith('processor')) {
                this.copyDir(path.join(root, name), path.join(dest, name));
            }
        }
    }

    private copyDir(srcDir: string, destDir: string): void {
        let entries;
        try {
            entries = readdirSync(srcDir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const src = path.join(srcDir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('processor')) {
                    this.copyDir(src, path.join(destDir, entry.name));
                }
            } else if (entry.isFile()) {
                this.copyFile(src, path.join(destDir, entry.name));
            }
        }
    }

    private copyFile(src: string, dest: string): void {
        try {
            if (statSync(src).size > MAX_FILE_SIZE) {
                return;
            }
            const content = readFileSync(src, 'utf-8');
            if (content.includes('\0') || /format\s+binary/.test(content.slice(0, 2048))) {
                return;
            }
            mkdirSync(path.dirname(dest), { recursive: true });
            writeFileSync(dest, content);
        } catch {
            // unreadable file: not copied
        }
    }
}
