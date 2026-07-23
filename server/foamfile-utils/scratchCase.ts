/*
    Scratch copies of OpenFOAM cases under os.tmpdir(), shared by the
    active banana trick and utility-based diagnostics: mutating programs
    (setFields) and deliberately-broken probe dictionaries must never
    touch the user's own case files.
*/
'use strict';

import { promises as fsp } from 'fs';
const path = require('path');

// case sub-trees worth copying, mirroring FoamWorkspaceIndex's walk/skip rules
const MAX_FILE_SIZE = 1024 * 1024;
// meshes are routinely bigger than dictionaries, and often binary
const MAX_MESH_FILE_SIZE = 64 * 1024 * 1024;
const SKIPPED_DIRS = new Set(['postProcessing', 'dynamicCode', 'polyMesh.bak', 'VTK']);
const INDEXED_TOPDIRS = /^(0.*|constant|system)$/;

export async function copyCaseSkeleton(root: string, dest: string): Promise<void> {
    let names: string[];
    try {
        names = await fsp.readdir(root);
    } catch {
        return;
    }
    for (const name of names) {
        if (INDEXED_TOPDIRS.test(name) && !name.startsWith('processor')) {
            await copyDir(path.join(root, name), path.join(dest, name));
        }
    }
}

async function copyDir(srcDir: string, destDir: string, raw = false): Promise<void> {
    let entries;
    try {
        entries = await fsp.readdir(srcDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const src = path.join(srcDir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('processor')) {
                // mesh data is copied byte-for-byte: utilities like checkMesh
                // are useless without it, and it is often binary
                await copyDir(src, path.join(destDir, entry.name), raw || entry.name === 'polyMesh');
            }
        } else if (entry.isFile()) {
            await copyFile(src, path.join(destDir, entry.name), raw);
        }
    }
}

async function copyFile(src: string, dest: string, raw: boolean): Promise<void> {
    try {
        if ((await fsp.stat(src)).size > (raw ? MAX_MESH_FILE_SIZE : MAX_FILE_SIZE)) {
            return;
        }
        if (!raw) {
            const content = await fsp.readFile(src, 'utf-8');
            if (content.includes('\0') || /format\s+binary/.test(content.slice(0, 2048))) {
                return;
            }
            await fsp.mkdir(path.dirname(dest), { recursive: true });
            await fsp.writeFile(dest, content);
            return;
        }
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(src, dest);
    } catch {
        // unreadable file: not copied
    }
}
