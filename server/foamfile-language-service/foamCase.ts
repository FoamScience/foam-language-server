/*
    OpenFOAM-domain model: where boundary-patch names live in a case and
    how to classify the symbol under the cursor. This is the shared brain
    behind rename, references, document highlight and patch definitions.

    Patch-name reference sites (v1):
    - constant(/region)/polyMesh/boundary   patch declarations + inGroups
    - <time>/<field> boundaryField/<patch>  keys (quoted regex keys skipped,
                                            exact alternations "(a|b)" rewritten)
    - system/blockMeshDict boundary(...)    declarations
    - system/blockMeshDict legacy           patches ( <type> <name> (faces...) ... )
                                            declarations (best effort: name is the
                                            identifier sandwiched between another
                                            identifier and a following list)
    - system/createPatchDict                name X; declarations + patches (...) refs
    - system/changeDictionaryDict           mirrored boundaryField/boundary keys
    - system/decomposeParDict               preservePatches/patches lists
    - system/snappyHexMeshDict              addLayersControls/layers/<patch> keys
                                            (quoted regex keys skipped, alternations
                                            rewritten, same as boundaryField;
                                            recognized by dict-ancestry, not position)
    - system/topoSetDict,                   patch X; (sourceInfo or inline) and
      system|constant/fvOptions             patches (...) lists, anywhere in the dict
    ponytail: skipped for now — snappyHexMeshDict castellatedMeshControls/
    refinementSurfaces/<surface> keys are geometry-derived (STL surface names,
    not patch names) and are intentionally never scanned as patch sites: this
    file's rename and find-references both feed off findPatchSites/isPatchSiteNode,
    so any site recognized there becomes a rename edit — there is no "reference
    only" tier to opt into without a caller that would use it. Upgrade path:
    split PatchSite into edit-sites vs. display-only sites if a consumer needs
    to list these separately. Also still skipped: topoSetDict/fvOptions region-
    based (non-patch) sources.

    Multi-region cases: patch names are scoped per mesh region. The region of
    the file a rename/reference starts in (index.regionOf) is captured during
    classifyPosition and every site scan is restricted to files of that region
    (null = the default region of single-region layouts), so same-named patches
    in different regions stay independent.
*/
'use strict';

import { Range } from 'vscode-languageserver-types';
import { FoamWorkspaceIndex, CaseFile } from './foamWorkspaceIndex';
import * as TreeParser from 'tree-sitter';
const path = require('path');

export type PatchSiteRole = 'declaration' | 'group-declaration' | 'key-reference' | 'list-reference';

export interface PatchSite {
    uri: string;
    range: Range;
    role: PatchSiteRole;
    // set when the site is a member inside a quoted alternation key like "(front|back)"
    quoted?: boolean;
}

export interface SymbolTarget {
    kind: 'patch' | 'patchGroup' | 'macro' | 'key' | 'include';
    name: string;
    node: TreeParser.SyntaxNode;
}

export function nodeRange(node: TreeParser.SyntaxNode): Range {
    return Range.create(
        node.startPosition.row, node.startPosition.column,
        node.endPosition.row, node.endPosition.column);
}

// keys of patch-list-valued entries, per file kind
const LIST_KEYS_BY_FILE: { file: RegExp, keys: Set<string> }[] = [
    { file: /(^|\/)decomposeParDict$/, keys: new Set(['preservePatches', 'patches', 'singleProcessorFaceSets']) },
    { file: /(^|\/)createPatchDict$/, keys: new Set(['patches']) },
    { file: /(^|\/)topoSetDict$/, keys: new Set(['patches']) },
    { file: /(^|\/)fvOptions$/, keys: new Set(['patches']) },
];

// keys of single-patch-valued entries ("patch X;"), per file kind
const SINGLE_REF_KEYS_BY_FILE: { file: RegExp, keys: Set<string> }[] = [
    { file: /(^|\/)topoSetDict$/, keys: new Set(['patch']) },
    { file: /(^|\/)fvOptions$/, keys: new Set(['patch']) },
];

export class FoamCase {

    private index: FoamWorkspaceIndex;
    // region context of the position being classified; undefined = no context
    // (scan every region, preserving single-region behavior for direct calls)
    private activeRegion: string | null | undefined = undefined;

    constructor(index: FoamWorkspaceIndex) {
        this.index = index;
    }

    /* ---------------- classification ---------------- */

    // Whether the identifier under the cursor is a patch name, a patch
    // group, a macro, an include path or a plain dictionary key
    public classifyPosition(uri: string, node: TreeParser.SyntaxNode): SymbolTarget | null {
        if (!node) {
            return null;
        }
        // inside a macro?
        let walker = node;
        while (walker) {
            if (walker.type === 'macro') {
                return { kind: 'macro', name: walker.text, node: walker };
            }
            if (walker.type === 'preproc_call') {
                return { kind: 'include', name: node.text.replace(/^"|"$/g, ''), node: walker };
            }
            walker = walker.parent;
        }
        if (node.type !== 'identifier' && node.type !== 'string_literal') {
            return null;
        }
        const name = node.text.replace(/^"|"$/g, '');
        const file = this.index ? this.index.getFile(uri) : null;
        // scope all subsequent site queries to the region this file belongs to
        this.activeRegion = file ? this.index.regionOf(file.relPath) : undefined;
        if (file) {
            if (this.isGroupSiteNode(file, node)) {
                return { kind: 'patchGroup', name, node };
            }
            if (this.isPatchSiteNode(file, node)) {
                // a boundaryField key matching a group (not a patch) selects the group
                if (!this.knownPatchNames().has(name) && this.knownGroupNames().has(name)) {
                    return { kind: 'patchGroup', name, node };
                }
                return { kind: 'patch', name, node };
            }
        }
        // plain key position: first named child of a key_value or dict
        // (positional compare — node wrapper identity is GC-dependent in
        // node-tree-sitter, `===` between separately marshaled wrappers flakes)
        const parent = node.parent;
        if (parent && (parent.type === 'key_value' || parent.type === 'dict')
            && parent.firstNamedChild?.startIndex === node.startIndex
            && parent.firstNamedChild?.endIndex === node.endIndex) {
            return { kind: 'key', name, node };
        }
        return null;
    }

    private knownPatchNames(): Set<string> {
        const names = new Set<string>();
        for (const file of this.caseFiles()) {
            for (const site of this.declarationSites(file)) {
                names.add(site.name);
            }
        }
        return names;
    }

    private knownGroupNames(): Set<string> {
        const groups = new Set<string>();
        for (const file of this.index?.boundaryFiles() ?? []) {
            if (!this.inActiveRegion(file)) {
                continue;
            }
            for (const patch of file.patches) {
                for (const g of patch.groups) {
                    groups.add(g);
                }
            }
        }
        return groups;
    }

    // case files scoped to the active region (all regions when no context)
    private caseFiles(): CaseFile[] {
        if (!this.index) {
            return [];
        }
        return [...this.index.files()].filter(f => this.inActiveRegion(f));
    }

    private inActiveRegion(file: CaseFile): boolean {
        return this.activeRegion === undefined
            || (this.index ? this.index.regionOf(file.relPath) : null) === this.activeRegion;
    }

    /* ---------------- per-file site scanners ---------------- */

    private relOf(file: CaseFile): string {
        return file.relPath.split(path.sep).join('/');
    }

    private isBoundaryFile(file: CaseFile): boolean {
        return /^constant\/(?:[^\/]+\/)?polyMesh\/boundary$/.test(this.relOf(file));
    }

    // <time>/<field> or <time>/<region>/<field>
    private isFieldFile(file: CaseFile): boolean {
        const parts = this.relOf(file).split('/');
        if (!parts[0].startsWith('0')) {
            return false;
        }
        if (parts.length === 2) {
            return true;
        }
        if (parts.length === 3) {
            return this.index ? this.index.knownRegions().has(parts[1]) : false;
        }
        return false;
    }

    private isChangeDictionary(file: CaseFile): boolean {
        return /(^|\/)changeDictionaryDict$/.test(this.relOf(file));
    }

    private isBlockMesh(file: CaseFile): boolean {
        return /(^|\/)blockMeshDict$/.test(this.relOf(file));
    }

    private isSnappyHexMesh(file: CaseFile): boolean {
        return /(^|\/)snappyHexMeshDict$/.test(this.relOf(file));
    }

    // identifier+dict_headless pairs: polyMesh/boundary root level and
    // blockMeshDict "boundary ( ... )" lists
    private* patchDeclarationNodes(file: CaseFile): Iterable<TreeParser.SyntaxNode> {
        const scanPairs = function* (container: TreeParser.SyntaxNode) {
            const kids = container.namedChildren;
            for (let i = 0; i + 1 < kids.length; i++) {
                if (kids[i].type === 'identifier' && kids[i + 1].type === 'dict_headless') {
                    yield kids[i];
                }
            }
        };
        if (this.isBoundaryFile(file)) {
            yield* scanPairs(file.tree.rootNode);
            for (const node of file.tree.rootNode.namedChildren) {
                if (node.type === 'list') {
                    yield* scanPairs(node);
                }
            }
        }
        if (this.isBlockMesh(file)) {
            for (const kv of file.tree.rootNode.descendantsOfType('key_value')) {
                if (kv.namedChild(0)?.text === 'boundary' && kv.namedChild(1)?.type === 'list') {
                    yield* scanPairs(kv.namedChild(1));
                }
                // legacy syntax: patches ( <type> <name> ( faces... ) ... )
                // best effort: a name is an identifier sandwiched between
                // another identifier (the type keyword) and a following list
                if (kv.namedChild(0)?.text === 'patches' && kv.namedChild(1)?.type === 'list') {
                    const kids = kv.namedChild(1).namedChildren;
                    for (let i = 0; i < kids.length; i++) {
                        if (kids[i].type === 'identifier'
                            && kids[i - 1]?.type === 'identifier'
                            && kids[i + 1]?.type === 'list') {
                            yield kids[i];
                        }
                    }
                }
            }
        }
        if (/(^|\/)createPatchDict$/.test(this.relOf(file))) {
            for (const kv of file.tree.rootNode.descendantsOfType('key_value')) {
                if (kv.namedChild(0)?.text === 'name'
                    && kv.namedChild(1)?.type === 'identifier') {
                    yield kv.namedChild(1);
                }
            }
        }
    }

    private declarationSites(file: CaseFile): { name: string, site: PatchSite }[] {
        const result = [];
        for (const node of this.patchDeclarationNodes(file)) {
            result.push({
                name: node.text,
                site: { uri: file.uri, range: nodeRange(node), role: 'declaration' as PatchSiteRole }
            });
        }
        return result;
    }

    // key nodes of a dict's direct child entries (name -> nested dict)
    private* dictEntryKeys(container: TreeParser.SyntaxNode): Iterable<TreeParser.SyntaxNode> {
        for (const core of container.namedChildren.filter(c => c.type === 'dict_core')) {
            for (const entry of core.namedChildren) {
                if ((entry.type === 'dict' || entry.type === 'dict_headless') && entry.firstNamedChild) {
                    const key = entry.firstNamedChild;
                    if (key.type === 'identifier' || key.type === 'string_literal') {
                        yield key;
                    }
                }
            }
        }
    }

    // dicts keyed under any `boundaryField` (field files, changeDictionaryDict)
    // and under a top-level `boundary` dict in changeDictionaryDict
    private* boundaryFieldKeyNodes(file: CaseFile): Iterable<TreeParser.SyntaxNode> {
        for (const dict of file.tree.rootNode.descendantsOfType('dict')) {
            const dictName = dict.firstNamedChild?.text;
            if (dictName === 'boundaryField' || (this.isChangeDictionary(file) && dictName === 'boundary')) {
                yield* this.dictEntryKeys(dict);
            }
        }
    }

    // snappyHexMeshDict addLayersControls/layers/<patch> keys, found by
    // dict-ancestry (a `layers` dict nested anywhere inside `addLayersControls`)
    private* layersKeyNodes(file: CaseFile): Iterable<TreeParser.SyntaxNode> {
        if (!this.isSnappyHexMesh(file)) {
            return;
        }
        for (const dict of file.tree.rootNode.descendantsOfType('dict')) {
            if (dict.firstNamedChild?.text !== 'layers') {
                continue;
            }
            let ancestor = dict.parent;
            let inLayersControls = false;
            while (ancestor) {
                if (ancestor.type === 'dict' && ancestor.firstNamedChild?.text === 'addLayersControls') {
                    inLayersControls = true;
                    break;
                }
                ancestor = ancestor.parent;
            }
            if (inLayersControls) {
                yield* this.dictEntryKeys(dict);
            }
        }
    }

    // identifiers inside list values of patch-list keys (decomposeParDict etc.)
    private* listReferenceNodes(file: CaseFile): Iterable<TreeParser.SyntaxNode> {
        const rel = this.relOf(file);
        const spec = LIST_KEYS_BY_FILE.find(s => s.file.test(rel));
        if (!spec) {
            return;
        }
        for (const kv of file.tree.rootNode.descendantsOfType('key_value')) {
            const key = kv.namedChild(0);
            const value = kv.namedChild(1);
            if (key && value && spec.keys.has(key.text) && value.type === 'list') {
                for (const item of value.namedChildren) {
                    if (item.type === 'identifier') {
                        yield item;
                    }
                }
            }
        }
    }

    // identifier value of single-patch-valued keys ("patch X;" in
    // topoSetDict/fvOptions), anywhere in the dict regardless of nesting
    private* singleReferenceNodes(file: CaseFile): Iterable<TreeParser.SyntaxNode> {
        const rel = this.relOf(file);
        const spec = SINGLE_REF_KEYS_BY_FILE.find(s => s.file.test(rel));
        if (!spec) {
            return;
        }
        for (const kv of file.tree.rootNode.descendantsOfType('key_value')) {
            const key = kv.namedChild(0);
            const value = kv.namedChild(1);
            if (key && value && spec.keys.has(key.text) && value.type === 'identifier') {
                yield value;
            }
        }
    }

    // inGroups ( ... ) identifiers in boundary files
    private* groupNodes(file: CaseFile): Iterable<TreeParser.SyntaxNode> {
        if (!this.isBoundaryFile(file)) {
            return;
        }
        for (const kv of file.tree.rootNode.descendantsOfType('key_value')) {
            if (kv.namedChild(0)?.text === 'inGroups' && kv.namedChild(1)?.type === 'list') {
                for (const item of kv.namedChild(1).namedChildren) {
                    if (item.type === 'identifier') {
                        yield item;
                    }
                }
            }
        }
    }

    /* ---------------- public site queries ---------------- */

    // key-reference sites matching `name` among `keys` (boundaryField-style:
    // plain identifier keys, or quoted exact alternations; other quoted
    // regex keys are skipped on purpose)
    private collectKeyReferenceSites(sites: PatchSite[], file: CaseFile, name: string, keys: Iterable<TreeParser.SyntaxNode>): void {
        for (const key of keys) {
            if (key.type === 'identifier' && key.text === name) {
                sites.push({ uri: file.uri, range: nodeRange(key), role: 'key-reference' });
            } else if (key.type === 'string_literal' && this.alternationMembers(key.text).includes(name)) {
                sites.push({ uri: file.uri, range: nodeRange(key), role: 'key-reference', quoted: true });
            }
        }
    }

    // Every site referring to patch `name` across the case
    public findPatchSites(name: string): PatchSite[] {
        const sites: PatchSite[] = [];
        for (const file of this.caseFiles()) {
            for (const decl of this.declarationSites(file)) {
                if (decl.name === name) {
                    sites.push(decl.site);
                }
            }
            if (this.isFieldFile(file) || this.isChangeDictionary(file)) {
                this.collectKeyReferenceSites(sites, file, name, this.boundaryFieldKeyNodes(file));
            }
            this.collectKeyReferenceSites(sites, file, name, this.layersKeyNodes(file));
            for (const item of this.listReferenceNodes(file)) {
                if (item.text === name) {
                    sites.push({ uri: file.uri, range: nodeRange(item), role: 'list-reference' });
                }
            }
            for (const item of this.singleReferenceNodes(file)) {
                if (item.text === name) {
                    sites.push({ uri: file.uri, range: nodeRange(item), role: 'list-reference' });
                }
            }
        }
        return sites;
    }

    // Every site referring to patch group `name`: inGroups members and
    // boundaryField keys selecting the group
    public findGroupSites(name: string): PatchSite[] {
        const sites: PatchSite[] = [];
        for (const file of this.caseFiles()) {
            for (const g of this.groupNodes(file)) {
                if (g.text === name) {
                    sites.push({ uri: file.uri, range: nodeRange(g), role: 'group-declaration' });
                }
            }
            if (this.isFieldFile(file) || this.isChangeDictionary(file)) {
                for (const key of this.boundaryFieldKeyNodes(file)) {
                    if (key.type === 'identifier' && key.text === name) {
                        sites.push({ uri: file.uri, range: nodeRange(key), role: 'key-reference' });
                    }
                }
            }
        }
        return sites;
    }

    // node identity across different parses of the same content
    private sameNode(a: TreeParser.SyntaxNode, b: TreeParser.SyntaxNode): boolean {
        return a.startIndex === b.startIndex && a.endIndex === b.endIndex && a.text === b.text;
    }

    // whether this identifier node is one of the patch sites of its file
    private isPatchSiteNode(file: CaseFile, node: TreeParser.SyntaxNode): boolean {
        for (const decl of this.patchDeclarationNodes(file)) {
            if (this.sameNode(decl, node)) {
                return true;
            }
        }
        if (this.isFieldFile(file) || this.isChangeDictionary(file)) {
            for (const key of this.boundaryFieldKeyNodes(file)) {
                if (this.sameNode(key, node)) {
                    return true;
                }
            }
        }
        for (const key of this.layersKeyNodes(file)) {
            if (this.sameNode(key, node)) {
                return true;
            }
        }
        for (const item of this.listReferenceNodes(file)) {
            if (this.sameNode(item, node)) {
                return true;
            }
        }
        for (const item of this.singleReferenceNodes(file)) {
            if (this.sameNode(item, node)) {
                return true;
            }
        }
        return false;
    }

    private isGroupSiteNode(file: CaseFile, node: TreeParser.SyntaxNode): boolean {
        for (const g of this.groupNodes(file)) {
            if (this.sameNode(g, node)) {
                return true;
            }
        }
        return false;
    }

    /* ---------------- quoted alternation handling ---------------- */

    // "(front|back)" -> ["front", "back"]; non-alternation regexes -> []
    public alternationMembers(quotedText: string): string[] {
        const match = quotedText.match(/^"\(([\w|]+)\)"$/);
        if (!match) {
            return [];
        }
        return match[1].split('|');
    }

    // rewrite one member of a quoted alternation key
    public rewriteAlternation(quotedText: string, oldName: string, newName: string): string {
        const members = this.alternationMembers(quotedText);
        return '"(' + members.map(m => m === oldName ? newName : m).join('|') + ')"';
    }

    /* ---------------- definitions ---------------- */

    // Declaration of a patch: real mesh first, then blockMeshDict,
    // then createPatchDict — mesh may not exist yet. Prefers the given
    // region's boundary/blockMesh files (defaults to the active region).
    public findPatchDeclaration(name: string, region: string | null | undefined = this.activeRegion): { uri: string, range: Range } | null {
        const fromMesh = this.index?.patchNames(region).get(name);
        if (fromMesh) {
            return { uri: fromMesh.uri, range: fromMesh.range };
        }
        for (const file of this.caseFiles()) {
            if (this.isBlockMesh(file) || /(^|\/)createPatchDict$/.test(this.relOf(file))) {
                for (const decl of this.declarationSites(file)) {
                    if (decl.name === name) {
                        return { uri: decl.site.uri, range: decl.site.range };
                    }
                }
            }
        }
        return null;
    }
}

/* ---------------- shared tree helpers (no index required) ---------------- */

// Smallest named node at an LSP position
export function nodeAtPosition(tree: TreeParser.Tree, line: number, character: number): TreeParser.SyntaxNode {
    let node = tree.rootNode.descendantForPosition({ row: line, column: character });
    // anonymous tokens (quotes, braces) -> nearest named ancestor
    while (node && !node.isNamed && node.parent) {
        node = node.parent;
    }
    return node;
}

// Navigate ["a", "b", "c"] inside a scope (root / dict / dict_headless),
// returning the value node of the final key_value (or the dict node)
export function findDictPath(scope: TreeParser.SyntaxNode, segments: string[]): TreeParser.SyntaxNode | null {
    if (segments.length === 0) {
        return null;
    }
    const entriesOf = function* (node: TreeParser.SyntaxNode): Iterable<TreeParser.SyntaxNode> {
        const containers = node.type === 'dict'
            ? node.namedChildren.filter(c => c.type === 'dict_core')
            : [node];
        for (const container of containers) {
            for (const child of container.namedChildren) {
                if (child.type === 'dict' || child.type === 'key_value' || child.type === 'dict_headless') {
                    yield child;
                }
            }
        }
    };
    let current = scope;
    for (let i = 0; i < segments.length; i++) {
        const name = segments[i];
        const last = i === segments.length - 1;
        let next: TreeParser.SyntaxNode = null;
        for (const entry of entriesOf(current)) {
            if (entry.firstNamedChild?.text === name) {
                if (last) {
                    return entry.type === 'key_value' ? (entry.namedChild(1) ?? entry) : entry;
                }
                if (entry.type === 'dict' || entry.type === 'dict_headless') {
                    next = entry;
                    break;
                }
            }
        }
        if (!next) {
            return null;
        }
        current = next;
    }
    return null;
}

// Parsed form of a macro token: $var, $.var, $..var, $:abs.path, $!abs.path
export interface MacroPath {
    absolute: boolean;
    dots: number;          // 0 = scoped lookup, 1 = current dict, 2 = parent, ...
    segments: string[];
}

export function parseMacro(text: string): MacroPath | null {
    if (!text.startsWith('$')) {
        return null;
    }
    let rest = text.slice(1);
    const absolute = rest.startsWith(':') || rest.startsWith('!');
    if (absolute) {
        rest = rest.slice(1);
    }
    let dots = 0;
    while (rest.startsWith('.')) {
        dots++;
        rest = rest.slice(1);
    }
    const segments = rest.split('.').filter(s => s.length > 0);
    if (segments.length === 0) {
        return null;
    }
    return { absolute, dots, segments };
}
