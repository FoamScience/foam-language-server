/*
    Pure bookkeeping for cross-file solver diagnostics, split out of
    foam-ls.ts so it can be unit-tested: foam-ls.ts starts listening on
    stdio as a side effect of being loaded, so it can't be require()'d
    from a test.
*/
'use strict';

import { Diagnostic } from 'vscode-languageserver-types';

/*
    Solver diagnostics for a run triggered from `sourceUri` can land on other
    files (byUri). Targets a previous run for the same source owned but that
    are absent from this run's results are cleared (set to an empty list) so
    a fixed error doesn't linger on a file nobody revalidated. Targets owned
    by a *different* source are left alone — each source only clears its own
    previous targets, so solver runs from different documents can't clobber
    each other's diagnostics.

    Mutates `byUri` in place (adding the cleared/empty entries) and returns
    the new target set to remember for `sourceUri`'s next run.
*/
export function reconcileSolverTargets(
    byUri: Map<string, Diagnostic[]>,
    previousTargets: Set<string>,
    sourceUri: string
): Set<string> {
    for (const target of previousTargets) {
        if (!byUri.has(target)) {
            byUri.set(target, []);
        }
    }
    if (!byUri.has(sourceUri)) {
        byUri.set(sourceUri, []);
    }
    const targets = new Set<string>();
    for (const uri of byUri.keys()) {
        if ((byUri.get(uri) as Diagnostic[]).length > 0) {
            targets.add(uri);
        }
    }
    return targets;
}
