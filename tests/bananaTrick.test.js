'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Parser = require('tree-sitter');
const foamLanguage = require('tree-sitter-foam');
const { FoamWorkspaceIndex } = require('../lib/foamfile-language-service/foamWorkspaceIndex');
const { FoamBananaTrick } = require('../lib/foamfile-language-service/foamBananaTrick');
const { LanguageService } = require('../lib/foamfile-language-service/languageService');

const CAVITY = path.join(__dirname, 'fixtures', 'cavity');

function newParser() {
    const parser = new Parser();
    parser.setLanguage(foamLanguage);
    return parser;
}

function fixtureStderr() {
    return fs.readFileSync(path.join(__dirname, 'fixtures', 'stderr', 'org-fatal-io-options.txt'), 'utf-8');
}

// recursive byte snapshot of a directory, for before/after integrity checks
function snapshot(dir) {
    const files = new Map();
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else {
                files.set(full, fs.readFileSync(full));
            }
        }
    };
    walk(dir);
    return files;
}

function posAtEnd(content, needle) {
    const at = content.indexOf(needle);
    assert.notStrictEqual(at, -1);
    const before = content.slice(0, at + needle.length);
    const line = before.split('\n').length - 1;
    return { line, character: at + needle.length - before.lastIndexOf('\n') - 1 };
}

async function newService() {
    const service = new LanguageService();
    await service.setTreeParser();
    service.initializeWorkspace('file://' + CAVITY);
    return service;
}

const FVSCHEMES_URI = 'file://' + path.join(CAVITY, 'system', 'fvSchemes');
const CONTENT = 'FoamFile\n{\n    object fvSchemes;\n}\n\nddtSchemes\n{\n    default st\n}\n';
const POSITION = posAtEnd(CONTENT, 'default st');

async function pollForSolverOptions(service, timeoutMs = 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const props = await service.computeCompletionItems(CONTENT, POSITION, undefined, FVSCHEMES_URI);
        if (props.some(p => p.detail === 'from solver')) {
            return props;
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for banana options to populate the completion cache');
}

describe('active banana trick: probe mechanics', () => {
    test('probe writes only under os.tmpdir() and leaves the case fixture byte-identical', async () => {
        const parser = newParser();
        const index = new FoamWorkspaceIndex(parser);
        index.initialize('file://' + CAVITY);
        const before = snapshot(CAVITY);

        const trick = new FoamBananaTrick(parser, async () => fixtureStderr());
        const writes = [];
        const originalWrite = fs.writeFileSync;
        fs.writeFileSync = (target, ...rest) => {
            writes.push(target);
            return originalWrite(target, ...rest);
        };
        // resolved before the probe runs: the scratch dir is gone (cleaned
        // up in the probe's `finally`) by the time we'd otherwise check it
        const tmpRoot = fs.realpathSync(os.tmpdir());
        let options;
        try {
            options = await trick.probe(FVSCHEMES_URI, ['ddtSchemes', 'default'], index);
        } finally {
            fs.writeFileSync = originalWrite;
        }

        assert.deepStrictEqual(options, ['CrankNicolson', 'Euler', 'backward', 'steadyState']);

        assert.ok(writes.length > 0, 'expected the probe to write its scratch copy');
        for (const target of writes) {
            assert.ok(target.startsWith(tmpRoot), `probe wrote outside os.tmpdir(): ${target}`);
        }

        assert.deepStrictEqual(snapshot(CAVITY), before, 'the fixture must be untouched after the probe');
    });

    test('missing dict path resolves to no options instead of throwing', async () => {
        const parser = newParser();
        const index = new FoamWorkspaceIndex(parser);
        index.initialize('file://' + CAVITY);
        const trick = new FoamBananaTrick(parser, async () => fixtureStderr());
        const options = await trick.probe(FVSCHEMES_URI, ['noSuchDict', 'noSuchKey'], index);
        assert.deepStrictEqual(options, []);
    });
});

describe('active banana trick: LanguageService integration', () => {
    test('flag off: the solver is never invoked and nothing is proposed', async () => {
        const service = await newService();
        let runnerCalls = 0;
        service.setBananaTrick(false, async () => { runnerCalls++; return fixtureStderr(); });

        const first = await service.computeCompletionItems(CONTENT, POSITION, undefined, FVSCHEMES_URI);
        assert.strictEqual(first.filter(p => p.detail === 'from solver').length, 0);

        await new Promise(resolve => setTimeout(resolve, 20));
        const second = await service.computeCompletionItems(CONTENT, POSITION, undefined, FVSCHEMES_URI);
        assert.strictEqual(second.filter(p => p.detail === 'from solver').length, 0);
        assert.strictEqual(runnerCalls, 0);
    });

    test('flag on: options land in the cache and appear on a later call, without re-running for the same keyword', async () => {
        const service = await newService();
        let runnerCalls = 0;
        service.setBananaTrick(true, async () => { runnerCalls++; return fixtureStderr(); });

        const first = await service.computeCompletionItems(CONTENT, POSITION, undefined, FVSCHEMES_URI);
        assert.strictEqual(first.filter(p => p.detail === 'from solver').length, 0,
            'the probe is fire-and-forget, nothing is cached yet on the triggering call');

        const props = await pollForSolverOptions(service);
        const fromSolver = props.filter(p => p.detail === 'from solver');
        assert.ok(fromSolver.some(p => p.label === 'steadyState'));
        assert.ok(runnerCalls >= 1);

        const callsSoFar = runnerCalls;
        await service.computeCompletionItems(CONTENT, POSITION, undefined, FVSCHEMES_URI);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.strictEqual(runnerCalls, callsSoFar, 'a cached (uri, keyword) must not re-probe');
    });
});
