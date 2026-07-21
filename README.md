# FOAM Language Server

> This project is *young*; still at early phases of development,
> so expect things to change considerably

> DISCLAIMER:
> This offering is not approved or endorsed by OpenCFD Limited, producer and distributor
> of the OpenFOAM software and owner of the OPENFOAM®  and OpenCFD®  trade marks.

An implementation of the Language Server Protocol ([LSP](https://microsoft.github.io/language-server-protocol/))
for OpenFOAM dictionaries.

Here is a quick demo of the most important features:

![foam lsp demo](./foam-lsp.gif)

For a more detailed explanation, check [this slide](https://foamscience.github.io/openfoam-with-neovim/) out.

We're supporting the following features (`*` for partial or limited support):

- **Auto-Completion**
    - [x] Context-aware keywords (per file kind: `controlDict`, `fvSchemes`, `fvSolution`, ...)
    - [x] Valid values for known keywords (`stopAt`, `writeControl`, boundary condition types, ...)
    - [x] Macro expansion, workspace-wide (`$`-triggered)
    - [x] Boundary patch names inside `boundaryField`
    - [x] Preprocessor directives (`#`-triggered) and snippets with documentation
    - [x] Passive "Banana Trick": `Valid options` lists harvested from solver
          errors are offered as high-priority value completions
    - [x] Banana-trick options carry documentation extracted from OpenFOAM
          class headers (`data/runtimeSelection.json`, regenerable against
          your OpenFOAM version — see [CONTRIBUTING](CONTRIBUTING.md))
- **Diagnostics** [layered]
    - [x] Instant syntax errors from the Tree-Sitter grammar (on every keystroke, no solver needed)
    - [x] Solver-based semantic errors: `FATAL ERROR`s, `FATAL IO ERROR`s and warnings,
          multiple errors per run, foundation (`.org`) and ESI (`.com`) error formats
    - [x] Async and debounced; the solver child process is always killed
    - [x] Workspace-wide (errors land on the file they point at)
    - [x] LSP 3.17 pull diagnostics with push fallback for older clients
- **Rename** [workspace-wide, OpenFOAM-aware]
    - [x] Boundary patches: renames across `constant/polyMesh/boundary`, field files'
          `boundaryField`, `blockMeshDict`, `createPatchDict`, `decomposeParDict`, ...
    - [x] Exact quoted alternations like `"(front|back)"` are rewritten member-wise
    - [x] Patch groups (`inGroups`) as their own namespace
    - [x] Dictionary keys: updates `$macro` references through `#include` chains
- **Find References / Document Highlight**
    - [x] Patches, patch groups, macros and dictionary keys
- **Jump to Definition**
    - [x] Macro expansion: absolute (`$:a.b`), scoped (`$a`) and relative (`$.a`, `$..a`) paths
    - [x] Cross-file resolution through `#include` chains
    - [x] `boundaryField` patch entry → its declaration in `constant/polyMesh/boundary`
          (falls back to `blockMeshDict`/`createPatchDict` when the mesh doesn't exist yet)
    - [x] `#include "file"` → the included file (also exposed as document links)
- **Document symbols** [Complete]
    - [x] Uses the Tree-Sitter grammar for OpenFOAM
    - [x] Can penetrate lists and peek inside
    - [x] Workspace-wide symbols from the case index
- **Hover Documentation & Signature Help**
    - [x] Keyword knowledge base in
          [`server/foamfile-language-service/data/keywords.json`](server/foamfile-language-service/data/keywords.json)
          — one JSON file feeding completion, hover and signature docs; PRs welcome
    - [x] Hover on runtime-selectable class names (`CrankNicolson`, `kOmegaSST`,
          boundary condition types, ...) shows the class description harvested
          from OpenFOAM sources
- **Folding, Semantic Tokens, Selection Ranges**
    - [x] Implemented server-side for clients without the Tree-Sitter grammar;
          (Neo)VIM users with `:TSInstall foam` already get folding/highlighting natively

Not planned:

- Formatting
    - Please use external C++/Typescript formatters if you're obsessed with
      nice-looking code.

## Installation and configuration

### Installation

If you want the (somewhat) stable code (from Releases):
```bash
npm install foam-language-server
```

If you want the bleeding-edge features, with all the bleeding-edge bugs:
```bash
git clone --depth 1 --single-branch -b develop https://github.com/FoamScience/foam-language-server
npm install
npm test
```

### Configuration

#### Root directory detection

It's important that your text editor detects the case directory as the "root directory"
because diagnostics will depend on it. Most editors will ask the LSP for the root directory,
but for those which don't, you'll have to configure it manually.

#### LSP configuration

Neovim (v0.11+, using `vim.lsp.config`):

```lua
vim.lsp.config('foam_ls', {
    cmd = { 'foam-ls', '--stdio' },
    filetypes = { 'foam' },
    root_markers = { 'system/controlDict' },
    settings = {
        foam = {
            languageserver = {
                diagnostics = {
                    -- "error" | "warning" | "ignore"
                    fatalError = 'error',
                    fatalIOError = 'error',
                },
            },
        },
    },
})
vim.lsp.enable('foam_ls')
```

Older Neovim with `nvim-lspconfig` works the same way through `lspconfig.foam_ls.setup{}`.

The server talks standard LSP over stdio, so any LSP client works: point it
at the `foam-ls` executable and make sure the workspace root is the case
directory. For the full capability list, see the return value of
`connection.onInitialize` in `server/foam-ls.ts`.

## FAQ

### Not a (Neo)VIM user?

> can I ask WHY?

It is possible to run this LSP implementation with any text editor or IDE which supports
LSP (most do), however Neo(VIM) has a clear priority and you may have to
give up some features for things to work on other editors.

### Can I run it on Windows?

Sure, you can. It's basically a piece of C++/JavaScript technology which has nothing to
do with OpenFOAM code base (other than parsing its file format, of course).

Currently the only feature which has a slim chance of working on Windows
is the "diagnostics" feature, because it needs to fire the case's solver to see if it errors
out (and captures `stderr`).

If you have solvers on your Windows PATH, and diagnostics are not showing up; please file a bug
report.

## Contributing to this project

Please skim through [CONTRIBUTING.md](/CONTRIBUTING.md) if you plan to join on the fun.
