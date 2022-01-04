# FOAM Language Server

> This project is *young*; still at early phases of development,
> so expect things to change considerably

> DISCLAIMER:
> This offering is not approved or endorsed by OpenCFD Limited, producer and distributor
> of the OpenFOAM software and owner of the OPENFOAM®  and OpenCFD®  trade marks.

An implementation of the Language Server Protocol ([LSP](https://microsoft.github.io/language-server-protocol/))
for OpenFOAM dictionaries.
We're supporting the following features (`*` for partial or limited support):

- **Auto-Completion** [Not fully implemented Yet]
    - [x] Macro expansion `*` (always suggests absolute paths)
    - [x] Common keywords `*`
    - [x] Snippets (with documentation) `*`
    - [ ] Valid entries based on the "Banana Trick" `?`
- **Document symbols** [Complete]
    - [x] Uses the Tree-Sitter grammar for OpenFOAM
    - [x] Can penetrate lists and peek inside
    - [x] Workspace-wide symbols
- **Jump to Definition** [Complete, works on a single file]
    - [x] Macro expansion of absolute paths
    - [x] Macro expansion of dictionary-relative paths
- **Hover Documentation** [Complete, but lacks actual keywords docs]
    - [x] Common keywords `*`
- **Signature Help** [Complete, but lacks docs for signature help]
    - [x] Common keywords `*`
- **Diagnostics** [Not fully implemented Yet,]
    - [x] Can handle most default `FATAL ERROR`s and `FATAL IO ERROR`s
    - [x] Needs to run the solver, so you'll get one error at a time
    - [x] Workspace-wide
    - [ ] Support for warnings
    - [ ] Custom error regular expressions

The following common LSP features will not be considered in the near future
(and PRs to these areas are actually _discourages_):

- Syntax-based Folding and Highlighting
    - Because [tree-sitter-foam](https://github.com/FoamScience/tree-sitter-foam) 
      has these features already.
    - All you have to do is `:TSInstall foam` (on (Neo)VIM, or equivalent)
- Formatting
    - Please use external C++/Typescript formatters if you're obsessed with
      nice-looking code.
- Semantic Tokenisation
    - We have little to no semantics in OpenFOAM file format. Especially, the lack
      of modifier-like constructs discourages extensive semantics tokenisation.
      Node types from the Tree-Sitter grammar are enough.

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

[TODO: Section not complete]

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
