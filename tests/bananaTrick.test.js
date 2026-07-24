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

function posAtEnd(content, needle, fromIndex = 0) {
    const at = content.indexOf(needle, fromIndex);
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

async function pollForSolverOptionsAt(service, content, position, timeoutMs = 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const props = await service.computeCompletionItems(content, position, undefined, FVSCHEMES_URI);
        if (props.some(p => p.detail === 'from solver')) {
            return props;
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for banana options to populate the completion cache');
}

async function pollForSolverOptions(service, timeoutMs = 1000) {
    return pollForSolverOptionsAt(service, CONTENT, POSITION, timeoutMs);
}

describe('active banana trick: probe mechanics', () => {
    test('probe writes only under os.tmpdir() and leaves the case fixture byte-identical', async () => {
        const parser = newParser();
        const index = new FoamWorkspaceIndex(parser);
        index.initialize('file://' + CAVITY);
        const before = snapshot(CAVITY);

        const trick = new FoamBananaTrick(parser, async () => fixtureStderr());
        const writes = [];
        const originalWrite = fs.promises.writeFile;
        fs.promises.writeFile = (target, ...rest) => {
            writes.push(target);
            return originalWrite.call(fs.promises, target, ...rest);
        };
        // Compare against the raw os.tmpdir(): the probe builds its scratch dir
        // with mkdtemp(os.tmpdir() + ...), so the captured write paths keep that
        // exact prefix. realpath'ing the root would break on macOS, where
        // os.tmpdir() is a /var symlink to /private/var while the write paths
        // keep the /var form. We can't realpath the targets either — they're
        // already deleted by the probe's cleanup by the time we assert.
        const tmpRoot = os.tmpdir();
        let options;
        try {
            options = await trick.probe(FVSCHEMES_URI, ['ddtSchemes', 'default'], index);
        } finally {
            fs.promises.writeFile = originalWrite;
        }

        assert.deepStrictEqual(options, ['CrankNicolson', 'Euler', 'backward', 'steadyState']);

        assert.ok(writes.length > 0, 'expected the probe to write its scratch copy');
        for (const target of writes) {
            assert.ok(target.startsWith(tmpRoot), `probe wrote outside os.tmpdir(): ${target}`);
        }

        assert.deepStrictEqual(snapshot(CAVITY), before, 'the fixture must be untouched after the probe');
    });

    test('probe does no synchronous fs work before its first await (issue #9)', async () => {
        const parser = newParser();
        const index = new FoamWorkspaceIndex(parser);
        index.initialize('file://' + CAVITY);
        const trick = new FoamBananaTrick(parser, async () => fixtureStderr());

        // the completion handler calls probe() synchronously; everything up
        // to its first await runs on the completion path and must not touch
        // the filesystem
        let syncCalls = 0;
        const originals = {};
        for (const name of ['mkdtempSync', 'readdirSync', 'readFileSync', 'writeFileSync', 'statSync']) {
            originals[name] = fs[name];
            fs[name] = (...args) => { syncCalls++; return originals[name](...args); };
        }
        let probing;
        try {
            probing = trick.probe(FVSCHEMES_URI, ['ddtSchemes', 'default'], index);
            assert.strictEqual(syncCalls, 0, 'probe() blocked the completion path with sync fs work');
        } finally {
            for (const name of Object.keys(originals)) {
                fs[name] = originals[name];
            }
        }
        const options = await probing;
        assert.deepStrictEqual(options, ['CrankNicolson', 'Euler', 'backward', 'steadyState']);
    });

    test('keyword absent from the saved file gets a synthesized "<keyword> banana;" entry', async () => {
        // issue #3's actual scenario: the user just typed a keyword that
        // is not in the on-disk file yet, so there is no value node to
        // splice over — the probe must synthesize a complete entry inside
        // the enclosing dict of the scratch copy
        const parser = newParser();
        const index = new FoamWorkspaceIndex(parser);
        index.initialize('file://' + CAVITY);
        const before = snapshot(CAVITY);
        const trick = new FoamBananaTrick(parser, async () => fixtureStderr());

        const writes = new Map();
        const originalWrite = fs.promises.writeFile;
        fs.promises.writeFile = (target, content, ...rest) => {
            writes.set(target, content);
            return originalWrite.call(fs.promises, target, content, ...rest);
        };
        let options;
        try {
            options = await trick.probe(FVSCHEMES_URI, ['ddtSchemes', 'phantomKeyword'], index);
        } finally {
            fs.promises.writeFile = originalWrite;
        }

        assert.deepStrictEqual(options, ['CrankNicolson', 'Euler', 'backward', 'steadyState']);
        const scratchContents = [...writes.values()].filter(c => typeof c === 'string');
        assert.ok(scratchContents.some(c => c.includes('phantomKeyword banana;')),
            'the scratch fvSchemes must contain a complete, well-formed entry');
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

describe('passive harvest: options scoped to the dict path the error names', () => {
    test('a harvested list is offered at its dict path and nowhere else in the file', async () => {
        const service = await newService();
        // org-fatal-io-options names file .../fvSchemes.ddtSchemes.default,
        // so its options must be scoped to ddtSchemes/default
        const errorUri = 'file:///home/user/cavity/system/fvSchemes';
        await service.validateWithSolver(FVSCHEMES_URI, '', undefined, async () => fixtureStderr());

        const content =
            'FoamFile\n{\n    object fvSchemes;\n}\n\n' +
            'ddtSchemes\n{\n    default st;\n}\n\n' +
            'gradSchemes\n{\n    default st;\n}\n';
        const ddtProps = await service.computeCompletionItems(content, posAtEnd(content, 'default st'), undefined, errorUri);
        assert.ok(ddtProps.some(p => p.detail === 'from solver' && p.label === 'steadyState'),
            'options must be offered at the dict path the solver error named');

        const gradPos = posAtEnd(content, 'default st', content.indexOf('gradSchemes'));
        const gradProps = await service.computeCompletionItems(content, gradPos, undefined, errorUri);
        assert.strictEqual(gradProps.filter(p => p.detail === 'from solver').length, 0,
            'gradSchemes/default must not inherit ddtSchemes/default options');
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
        assert.strictEqual(runnerCalls, callsSoFar, 'a cached (uri, dict path) must not re-probe');
    });

    test('same bare keyword in two different dicts is cached and probed separately', async () => {
        const service = await newService();
        let runnerCalls = 0;
        service.setBananaTrick(true, async () => { runnerCalls++; return fixtureStderr(); });

        const content =
            'FoamFile\n{\n    object fvSchemes;\n}\n\n' +
            'ddtSchemes\n{\n    default st;\n}\n\n' +
            'gradSchemes\n{\n    default st;\n}\n';
        const ddtPos = posAtEnd(content, 'default st');
        const gradPos = posAtEnd(content, 'default st', content.indexOf('gradSchemes'));

        await service.computeCompletionItems(content, ddtPos, undefined, FVSCHEMES_URI);
        const ddtProps = await pollForSolverOptionsAt(service, content, ddtPos);
        assert.ok(ddtProps.some(p => p.detail === 'from solver'),
            'ddtSchemes/default should get its own cached options');
        const callsAfterDdt = runnerCalls;
        assert.ok(callsAfterDdt >= 1);

        // gradSchemes/default shares the bare keyword "default" but is a
        // different dict path; it must not reuse ddtSchemes/default's cache
        // entry and must trigger its own probe
        const gradFirst = await service.computeCompletionItems(content, gradPos, undefined, FVSCHEMES_URI);
        assert.strictEqual(gradFirst.filter(p => p.detail === 'from solver').length, 0,
            'gradSchemes/default has not been probed yet, so nothing is cached for it');
        const gradProps = await pollForSolverOptionsAt(service, content, gradPos);
        assert.ok(gradProps.some(p => p.detail === 'from solver'));
        assert.ok(runnerCalls > callsAfterDdt, 'gradSchemes/default must trigger its own probe');
    });
});
