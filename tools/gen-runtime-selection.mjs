#!/usr/bin/env node
/*
    Generate server/foamfile-language-service/data/runtimeSelection.json
    from an OpenFOAM source tree (issue #15).

    Harvests TypeName("...")/ClassName("...") declarations from headers —
    those strings are exactly the lookup keys solvers print in
    "Valid options" lists — together with the header's Class/Description
    comment block.

    Usage: node tools/gen-runtime-selection.mjs [/path/to/OpenFOAM/src ...]
    Defaults to $FOAM_SRC. Descriptions are GPL text copied verbatim from
    OpenFOAM headers; this repo is GPL-3.0-or-later, attribution in _meta.
*/
'use strict';

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = process.argv.slice(2).length ? process.argv.slice(2)
    : (process.env.FOAM_SRC ? [process.env.FOAM_SRC] : []);
if (!roots.length) {
    console.error('usage: gen-runtime-selection.mjs <OpenFOAM src dir>... (or set $FOAM_SRC)');
    process.exit(1);
}

const SECTION_END = /^(Usage|Note|See\s?[Aa]lso|SourceFiles|Author|Class|Warning|To[Dd]o)\b|^-{5,}|^\*\/|\*\/\s*$/;
const MAX_DOC = 400;
const MAX_ENTRIES_PER_NAME = 3;

function* headers(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (e.isSymbolicLink()) continue;               // lnInclude farms
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name !== 'lnInclude') yield* headers(p);
        } else if (e.name.endsWith('.H')) {
            yield p;
        }
    }
}

function extract(content) {
    const names = [...content.matchAll(/^\s*(?:Type|Class)Name\s*\(\s*"([^"]+)"\s*\)\s*;/mg)]
        .map(m => m[1])
        .filter(n => /^[\w.:+-]+$/.test(n));
    if (!names.length) return null;

    const classMatch = content.match(/^Class\s*\r?\n\s+(\S+)/m);
    const cls = classMatch ? classMatch[1] : undefined;

    let doc;
    const descMatch = content.match(/^Description\s*\r?\n([\s\S]{0,4000})/m);
    if (descMatch) {
        const lines = [];
        for (const raw of descMatch[1].split(/\r?\n/)) {
            const line = raw.trim();
            if (line === '' || SECTION_END.test(line)) break;   // first paragraph only
            lines.push(line);
        }
        doc = lines.join(' ').replace(/\s+/g, ' ').trim();
        if (doc.length > MAX_DOC) doc = doc.slice(0, MAX_DOC - 1).replace(/\s+\S*$/, '') + '…';
        if (!doc) doc = undefined;
    }
    return { names: [...new Set(names)], cls, doc };
}

const entries = {};
let files = 0;
for (const root of roots) {
    for (const file of headers(root)) {
        files++;
        let content;
        try { content = readFileSync(file, 'utf-8'); } catch { continue; }
        const found = extract(content);
        if (!found) continue;
        const src = path.relative(root, file);
        for (const name of found.names) {
            (entries[name] ??= []).push({
                ...(found.cls ? { class: found.cls } : {}),
                ...(found.doc ? { doc: found.doc } : {}),
                src
            });
        }
    }
}

let collisions = 0;
for (const name of Object.keys(entries)) {
    if (entries[name].length > 1) {
        collisions++;
        entries[name].sort((a, b) => (b.doc ? 1 : 0) - (a.doc ? 1 : 0));
        entries[name] = entries[name].slice(0, MAX_ENTRIES_PER_NAME);
    }
}

const sorted = {};
for (const name of Object.keys(entries).sort()) sorted[name] = entries[name];

const out = {
    _meta: {
        source: roots.map(r => path.basename(r.replace(/\/src\/?$/, ''))).join(', '),
        license: 'Descriptions extracted from OpenFOAM headers (GPL-3.0-or-later)',
        generated: new Date().toISOString().slice(0, 10)
    },
    entries: sorted
};

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)),
    '../server/foamfile-language-service/data/runtimeSelection.json');
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(`${files} headers scanned, ${Object.keys(sorted).length} names (${collisions} with collisions) -> ${outPath}`);
