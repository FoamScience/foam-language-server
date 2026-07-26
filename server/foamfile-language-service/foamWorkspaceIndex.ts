/*
    Workspace (OpenFOAM case) index: every dictionary in the case parsed
    and queryable, powering cross-file features (rename, references,
    definition, completion).

    Memory model: cases are typically a few dozen small files, so parsed
    trees and content are kept for every indexed file. Open-document
    edits are mirrored in via refreshFromDocument() using the already
    cached tree — no disk round trip.
*/
'use strict';

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { Range, SymbolInformation } from 'vscode-languageserver-types';
import { FoamSymbols } from './foamSymbols';
import * as TreeParser from 'tree-sitter';
const path = require('path');

const MAX_FILE_SIZE = 1024 * 1024;
const SKIPPED_DIRS = new Set(['postProcessing', 'dynamicCode', 'polyMesh.bak', 'VTK']);
// case sub-trees worth indexing
const INDEXED_TOPDIRS = /^(0.*|constant|system)$/;

export interface ResolvedInclude {
    directive: string;      // include | includeEtc | includeIfPresent | includeFunc
    rawPath: string;        // as written, quotes stripped
    range: Range;           // of the whole directive node
    targetUri: string | null;
}

export interface PatchDeclaration {
    name: string;
    range: Range;
    groups: string[];       // inGroups entries of this patch
}

export interface CaseFile {
    uri: string;
    relPath: string;        // case-relative, e.g. "0/U", "constant/polyMesh/boundary"
    tree: TreeParser.Tree;
    content: string;
    symbols: SymbolInformation[];
    referable: SymbolInformation[];   // macro-targetable symbols
    includes: ResolvedInclude[];
    patches: PatchDeclaration[];      // only for polyMesh boundary files
}

function uriToPath(uri: string): string {
    return uri.replace(/^file:\/\//, '');
}

function pathToUri(p: string): string {
    return "file://" + p;
}

function nodeRange(node: TreeParser.SyntaxNode): Range {
    return Range.create(
        node.startPosition.row, node.startPosition.column,
        node.endPosition.row, node.endPosition.column);
}

export class FoamWorkspaceIndex {

    private parser: TreeParser;
    private foamSymbols: FoamSymbols;
    private rootPath: string | null = null;
    private entries: Map<string, CaseFile> = new Map();
    private reverseIncludes: Map<string, Set<string>> = new Map();
    // ponytail: memoized region set, invalidated on any index mutation
    private regionsCache: Set<string> | null = null;

    constructor(parser: TreeParser) {
        this.parser = parser;
        this.foamSymbols = new FoamSymbols(parser);
    }

    public getRootPath(): string | null {
        return this.rootPath;
    }

    public initialize(rootUri: string): void {
        this.rootPath = uriToPath(rootUri);
        this.entries.clear();
        this.regionsCache = null;
        let names: string[];
        try {
            names = readdirSync(this.rootPath);
        } catch {
            return;
        }
        for (const name of names) {
            if (INDEXED_TOPDIRS.test(name) && !name.startsWith('processor')) {
                this.scanDir(path.join(this.rootPath, name));
            }
        }
        this.rebuildReverseIncludes();
    }

    private scanDir(dir: string): void {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('processor')) {
                    this.scanDir(full);
                }
            } else if (entry.isFile()) {
                this.indexFile(full);
            }
        }
    }

    private indexFile(filePath: string): void {
        try {
            if (statSync(filePath).size > MAX_FILE_SIZE) {
                return;
            }
            const content = readFileSync(filePath, 'utf-8');
            // binary FoamFile payloads (or anything with NULs) are not parseable text
            if (content.includes('\0') || /format\s+binary/.test(content.slice(0, 2048))) {
                return;
            }
            this.indexContent(pathToUri(filePath), content);
        } catch {
            // unreadable file: not indexed
        }
    }

    // (Re-)index a file from known content, reusing a pre-parsed tree when given
    public indexContent(uri: string, content: string, tree?: TreeParser.Tree): void {
        if (!this.rootPath) {
            return;
        }
        const filePath = uriToPath(uri);
        // case-relative path is a display/key value and is compared as a
        // POSIX string ("0/U"); normalize away Windows backslashes
        const relPath = path.relative(this.rootPath, filePath).split(path.sep).join('/');
        if (relPath.startsWith('..')) {
            return; // outside the case
        }
        const parsedTree = tree ?? this.parser.parse(content);
        if (parsedTree.rootNode.type !== 'foam') {
            return;
        }
        const id = { uri };
        const symbols: SymbolInformation[] = [];
        for (const s of this.foamSymbols.traverseSymbolTree(parsedTree, id, false)) {
            symbols.push(s);
        }
        const referable: SymbolInformation[] = [];
        for (const s of this.foamSymbols.traverseSymbolTree(parsedTree, id, true)) {
            referable.push(s);
        }
        this.entries.set(uri, {
            uri,
            relPath,
            tree: parsedTree,
            content,
            symbols,
            referable,
            includes: this.extractIncludes(parsedTree, filePath),
            patches: this.isBoundaryFile(relPath) ? this.extractPatches(parsedTree) : [],
        });
        this.regionsCache = null;
    }

    public remove(uri: string): void {
        this.entries.delete(uri);
        this.regionsCache = null;
        this.rebuildReverseIncludes();
    }

    // Re-read a (possibly new) file from disk, e.g. on watched-file events
    public reindexUri(uri: string): void {
        this.indexFile(uriToPath(uri));
        this.rebuildReverseIncludes();
    }

    // Mirror an open document's state into the index
    public refreshFromDocument(uri: string, content: string, tree?: TreeParser.Tree): void {
        this.indexContent(uri, content, tree);
        this.rebuildReverseIncludes();
    }

    /* ------------------------- queries ------------------------- */

    public files(): Iterable<CaseFile> {
        return this.entries.values();
    }

    public getFile(uri: string): CaseFile | null {
        return this.entries.get(uri) ?? null;
    }

    private isBoundaryFile(relPath: string): boolean {
        return /^constant\/(?:[^\/]+\/)?polyMesh\/boundary$/.test(relPath.split(path.sep).join('/'));
    }

    public boundaryFiles(): CaseFile[] {
        return [...this.entries.values()].filter(f => this.isBoundaryFile(f.relPath));
    }

    // field file: <time>/<field> (default region) or <time>/<region>/<field>
    private isFieldFile(relPath: string): boolean {
        const parts = relPath.split(path.sep).join('/').split('/');
        if (!parts[0].startsWith('0')) {
            return false;
        }
        if (parts.length === 2) {
            return true;
        }
        if (parts.length === 3) {
            return this.knownRegions().has(parts[1]);
        }
        return false;
    }

    public fieldFiles(): CaseFile[] {
        return [...this.entries.values()].filter(f => this.isFieldFile(f.relPath));
    }

    /* ------------------------- regions ------------------------- */

    // Mesh regions of the case: the set of constant/<r>/polyMesh dirs present
    // plus any regions declared in constant/regionProperties (covers cases
    // whose per-region meshes have not been generated yet)
    public knownRegions(): Set<string> {
        if (this.regionsCache) {
            return this.regionsCache;
        }
        const regions = new Set<string>();
        for (const file of this.entries.values()) {
            const rel = file.relPath.split(path.sep).join('/');
            const mesh = rel.match(/^constant\/([^\/]+)\/polyMesh\//);
            if (mesh) {
                regions.add(mesh[1]);
            }
            if (/(^|\/)regionProperties$/.test(rel)) {
                for (const r of this.parseRegionProperties(file.tree)) {
                    regions.add(r);
                }
            }
        }
        this.regionsCache = regions;
        return regions;
    }

    // region names declared in `regions ( ... )`: both the nested form
    // `fluid (mesh1 mesh2) solid (mesh3)` (members taken, category skipped)
    // and the flat form `regions (fluid solid);`
    private parseRegionProperties(tree: TreeParser.Tree): string[] {
        const names: string[] = [];
        for (const kv of tree.rootNode.descendantsOfType('key_value')) {
            if (kv.namedChild(0)?.text === 'regions' && kv.namedChild(1)?.type === 'list') {
                const kids = kv.namedChild(1).namedChildren;
                for (let i = 0; i < kids.length; i++) {
                    if (kids[i].type === 'list') {
                        for (const m of kids[i].namedChildren) {
                            if (m.type === 'identifier') {
                                names.push(m.text);
                            }
                        }
                    } else if (kids[i].type === 'identifier' && kids[i + 1]?.type !== 'list') {
                        names.push(kids[i].text);
                    }
                }
            }
        }
        return names;
    }

    // Region a case-relative path belongs to, or null for the default region.
    // constant/<r>/..., system/<r>/<dict>, <time>/<r>/<field> when <r> is a
    // known region; everything else (constant/polyMesh, system/<dict>,
    // <time>/<field>) is the default region.
    public regionOf(relPath: string): string | null {
        const parts = relPath.split(path.sep).join('/').split('/');
        if (parts.length >= 3
            && (parts[0] === 'constant' || parts[0] === 'system' || parts[0].startsWith('0'))
            && this.knownRegions().has(parts[1])) {
            return parts[1];
        }
        return null;
    }

    public systemFiles(name?: string): CaseFile[] {
        return [...this.entries.values()].filter(f => {
            const rel = f.relPath.split(path.sep).join('/');
            if (!rel.startsWith('system/')) {
                return false;
            }
            return name === undefined || path.basename(rel) === name;
        });
    }

    // Patch declarations from boundary files. With no argument, every region
    // is merged (unchanged behavior); pass a region (or null for the default
    // region) to restrict to that region's boundary files.
    public patchNames(region?: string | null): Map<string, { uri: string, range: Range, groups: string[] }> {
        const result = new Map();
        for (const file of this.boundaryFiles()) {
            if (region !== undefined && this.regionOf(file.relPath) !== region) {
                continue;
            }
            for (const patch of file.patches) {
                result.set(patch.name, { uri: file.uri, range: patch.range, groups: patch.groups });
            }
        }
        return result;
    }

    public symbolsNamed(name: string): { uri: string, range: Range }[] {
        const result = [];
        for (const file of this.entries.values()) {
            for (const sym of file.symbols) {
                if (sym.name === name) {
                    result.push({ uri: file.uri, range: sym.location.range });
                }
            }
        }
        return result;
    }

    public allSymbols(): SymbolInformation[] {
        const result: SymbolInformation[] = [];
        for (const file of this.entries.values()) {
            result.push(...file.symbols);
        }
        return result;
    }

    public macroTargets(): { name: string, uri: string, range: Range }[] {
        const result = [];
        for (const file of this.entries.values()) {
            for (const sym of file.referable) {
                result.push({ name: sym.name, uri: file.uri, range: sym.location.range });
            }
        }
        return result;
    }

    /* ------------------------- includes ------------------------- */

    private extractIncludes(tree: TreeParser.Tree, filePath: string): ResolvedInclude[] {
        const includes: ResolvedInclude[] = [];
        const visit = (node: TreeParser.SyntaxNode) => {
            if (node.type === 'preproc_call') {
                const name = node.namedChildren.find(c => c.type === 'identifier');
                const arg = node.namedChildren.find(c => c.type === 'string_literal');
                if (name && arg && name.text.startsWith('include')) {
                    const rawPath = arg.text.replace(/^"|"$/g, '');
                    includes.push({
                        directive: name.text,
                        rawPath,
                        range: nodeRange(node),
                        targetUri: this.resolveIncludePath(name.text, rawPath, path.dirname(filePath)),
                    });
                }
            }
            for (const child of node.children) {
                visit(child);
            }
        };
        visit(tree.rootNode);
        return includes;
    }

    // Resolution rules shared by definition/links: relative to the including
    // file's dir, then the case root; $VAR and <case>/<constant>/<system>
    // expansions; includeEtc goes through FOAM_ETC / WM_PROJECT_DIR/etc
    public resolveIncludePath(directive: string, rawPath: string, includingDir: string): string | null {
        let expanded = rawPath
            .replace(/\$FOAM_CASE/g, this.rootPath ?? '')
            .replace(/<case>/g, this.rootPath ?? '')
            .replace(/<constant>/g, path.join(this.rootPath ?? '', 'constant'))
            .replace(/<system>/g, path.join(this.rootPath ?? '', 'system'))
            .replace(/\$(\w+)/g, (_, v) => process.env[v] ?? '');
        if (directive === 'includeEtc') {
            const etc = process.env.FOAM_ETC
                ?? (process.env.WM_PROJECT_DIR ? path.join(process.env.WM_PROJECT_DIR, 'etc') : null);
            if (!etc) {
                return null;
            }
            const candidate = path.join(etc, expanded);
            return existsSync(candidate) ? pathToUri(candidate) : null;
        }
        const candidates = path.isAbsolute(expanded)
            ? [expanded]
            : [path.join(includingDir, expanded), path.join(this.rootPath ?? '', expanded)];
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return pathToUri(candidate);
            }
        }
        return null;
    }

    public includesOf(uri: string): ResolvedInclude[] {
        return this.entries.get(uri)?.includes ?? [];
    }

    public includedBy(uri: string): string[] {
        return [...(this.reverseIncludes.get(uri) ?? [])];
    }

    // Transitive includes in read order (depth-first, pre-order)
    public includeClosure(uri: string): string[] {
        const seen = new Set<string>([uri]);
        const order: string[] = [];
        const visit = (u: string) => {
            for (const inc of this.includesOf(u)) {
                if (inc.targetUri && !seen.has(inc.targetUri)) {
                    seen.add(inc.targetUri);
                    order.push(inc.targetUri);
                    visit(inc.targetUri);
                }
            }
        };
        visit(uri);
        return order;
    }

    private rebuildReverseIncludes(): void {
        this.reverseIncludes.clear();
        for (const file of this.entries.values()) {
            for (const inc of file.includes) {
                if (inc.targetUri) {
                    let set = this.reverseIncludes.get(inc.targetUri);
                    if (!set) {
                        set = new Set();
                        this.reverseIncludes.set(inc.targetUri, set);
                    }
                    set.add(file.uri);
                }
            }
        }
    }

    /* ------------------------- patches ------------------------- */

    // constant/polyMesh/boundary: patch entries parse as an `identifier`
    // followed by a `dict_headless` sibling — either directly at the root
    // (the surrounding parens are anonymous tokens) or inside a `list`
    private extractPatches(tree: TreeParser.Tree): PatchDeclaration[] {
        const patches: PatchDeclaration[] = [];
        const scanPairs = (container: TreeParser.SyntaxNode) => {
            const kids = container.namedChildren;
            for (let i = 0; i + 1 < kids.length; i++) {
                if (kids[i].type === 'identifier' && kids[i + 1].type === 'dict_headless') {
                    const nameNode = kids[i];
                    const groups: string[] = [];
                    for (const kv of kids[i + 1].descendantsOfType('key_value')) {
                        if (kv.namedChild(0)?.text === 'inGroups') {
                            const value = kv.namedChild(1);
                            if (value && value.type === 'list') {
                                for (const g of value.namedChildren) {
                                    if (g.type === 'identifier') {
                                        groups.push(g.text);
                                    }
                                }
                            }
                        }
                    }
                    patches.push({ name: nameNode.text, range: nodeRange(nameNode), groups });
                }
            }
        };
        scanPairs(tree.rootNode);
        for (const node of tree.rootNode.namedChildren) {
            if (node.type === 'list') {
                scanPairs(node);
            }
        }
        return patches;
    }

    /* ------------------------- dict path lookup ------------------------- */

    // Value node of an absolute dictionary path like ["boundaryField", "inlet", "type"]
    public keyValueAt(uri: string, dictPath: string[]): TreeParser.SyntaxNode | null {
        const file = this.entries.get(uri);
        if (!file || dictPath.length === 0) {
            return null;
        }
        let scope: TreeParser.SyntaxNode = file.tree.rootNode;
        for (let i = 0; i < dictPath.length; i++) {
            const name = dictPath[i];
            const last = i === dictPath.length - 1;
            let found: TreeParser.SyntaxNode = null;
            for (const child of this.namedEntriesOf(scope)) {
                const keyNode = child.firstNamedChild;
                if (keyNode && keyNode.text === name) {
                    if (last) {
                        return child.type === 'key_value' ? (child.namedChild(1) ?? child) : child;
                    }
                    if (child.type === 'dict') {
                        found = child;
                        break;
                    }
                }
            }
            if (!found) {
                return null;
            }
            scope = found;
        }
        return null;
    }

    // dict entries of a scope node (root or dict), looking through dict_core
    private* namedEntriesOf(scope: TreeParser.SyntaxNode): Iterable<TreeParser.SyntaxNode> {
        const containers = scope.type === 'dict'
            ? scope.namedChildren.filter(c => c.type === 'dict_core')
            : [scope];
        for (const container of containers) {
            for (const child of container.namedChildren) {
                if (child.type === 'dict' || child.type === 'key_value') {
                    yield child;
                }
            }
        }
    }
}
