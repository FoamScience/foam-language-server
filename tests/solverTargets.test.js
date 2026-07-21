'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { reconcileSolverTargets } = require('../lib/solverTargets');

describe('reconcileSolverTargets', () => {
    test('a target with no previous history is left alone and reported back when it has diagnostics', () => {
        const byUri = new Map([['fileA', [{ message: 'boom' }]]]);
        const targets = reconcileSolverTargets(byUri, new Set(), 'sourceA');
        assert.deepStrictEqual([...byUri.keys()].sort(), ['fileA', 'sourceA']);
        assert.deepStrictEqual(byUri.get('sourceA'), []);
        assert.deepStrictEqual([...targets].sort(), ['fileA']);
    });

    test('a previously owned target absent from the new result is cleared to an empty list', () => {
        const byUri = new Map(); // the error moved off fileA entirely
        const targets = reconcileSolverTargets(byUri, new Set(['fileA']), 'sourceA');
        assert.deepStrictEqual(byUri.get('fileA'), []);
        assert.deepStrictEqual([...targets], []);
    });

    test('an error that moves from one target to another clears the old one and reports only the new one', () => {
        const byUri = new Map([['fileB', [{ message: 'boom' }]]]);
        const targets = reconcileSolverTargets(byUri, new Set(['fileA']), 'sourceA');
        assert.deepStrictEqual(byUri.get('fileA'), []);
        assert.deepStrictEqual(byUri.get('fileB'), [{ message: 'boom' }]);
        assert.deepStrictEqual([...targets].sort(), ['fileB']);
    });

    test('two source documents tracked independently do not clobber each other\'s targets', () => {
        // mirrors foam-ls.ts's `lastSolverTargets: Map<sourceUri, Set<targetUri>>` usage
        const lastSolverTargets = new Map();

        // sourceA's run puts an error on sharedTarget
        let byUriA = new Map([['sharedTarget', [{ message: 'from A' }]]]);
        lastSolverTargets.set('sourceA',
            reconcileSolverTargets(byUriA, lastSolverTargets.get('sourceA') ?? new Set(), 'sourceA'));
        assert.deepStrictEqual(byUriA.get('sharedTarget'), [{ message: 'from A' }]);

        // sourceB's run, with no errors of its own, must not clear sourceA's
        // still-live slice of sharedTarget just because it isn't in sourceB's
        // own previous-targets history
        let byUriB = new Map();
        lastSolverTargets.set('sourceB',
            reconcileSolverTargets(byUriB, lastSolverTargets.get('sourceB') ?? new Set(), 'sourceB'));
        assert.ok(!byUriB.has('sharedTarget'), 'sourceB never owned sharedTarget, so its run must not touch it');
    });
});
