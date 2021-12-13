# FOAM Language Server

> This is young project; still at early phases of development,
> so expect things to change considerably

An implementation of the Language Server Protocol ([LSP](https://microsoft.github.io/language-server-protocol/))
for OpenFOAM dictionaries.
We're supporting the following features (`*` for partial or limited support):

- **Auto-Completion** [Not fully implemented Yet]
    - [x] Macro expansion `*`
    - [x] Common keywords `*`
    - [x] Snippets (with documentation) `*`
    - [ ] Valid entries based on the "Banana Trick" `?`
- **Document symbols** [Complete, works on a single file]
    - [x] Uses the Tree-Sitter grammar for OpenFOAM
    - [x] Can penetrate lists and peek inside
- **Jump to Definition** [Complete, works on a single file]
    - [x] Macro expansion of absolute paths
    - [x] Macro expansion of dictionary-relative paths
- **Hover Documentation** [Complete, but lacks actual keywords docs]
    - [x] Common keywords `*`
- **Signature Help** [Complete, but lacks docs for signature help]
    - [x] Common keywords `*`
- **Diagnostics** [Not fully implemented Yet,]
    - [x] Can handle most default `FATAL ERROR`s and `FATAL IO ERROR`s
    - [x] Uses OpenFOAM parser (not fault tolerant), so you get one diagnostic at a time
    - [ ] Allows for custom error detection
    - [ ] Workspace-wide

The following common LSP features will not be considered in the near future
(and PRs to these areas are actually _discourages_):

- Syntax-based Folding and Highlighting
    - Because [tree-sitter-foam](https://github.com/FoamScience/tree-sitter-foam) 
      has these features already.
    - All you have to do is `:TSInstall foam` (on (Neo)VIM, or equivalent) and detect
      the file type.
- Formatting
    - I don't why people use formatters, set up your editor to write inherently
      formatted code, that's all!
- Semantic Tokenisation
    - We have little to no semantics in OpenFOAM file format. Especially, the lack
      of modifier-like constructs discourages extensive semantics tokenisation.
      Node types from the Tree-Sitter grammar are enough.

## Installation and configuration

### Configuration

#### File Type detection

First, you must make sure your text editor assigns the file type `type` to
OpenFOAM dictionaries.

#### Root directory detection

It's important that your text editor detects the case directory as the "root directory"
as diagnostics will depend on it.

#### LSP configuration

[Section not complete]

## JS bindings for the OpenFOAM parser library

> This feature is experimental

The `src` directory implements a traditional parser library for OpenFOAM dictionaries
(currently, compiles only with Foam-Extend-4) which is not fault tolerant. It
is used only for **Diagnostics** and nothing else.

The parser library has JS bindings to enable seamless and fast interaction with
OpenFOAM dictionaries, but the [Tree-Sitter grammar](https://github.com/FoamScience/tree-sitter-foam)
is preferred.

## Not a (Neo)VIM user?

> can I ask WHY?

It is possible to run this LSP implementation with any text editor or IDE which supports
LSP (most do), however Neo(VIM) has a clear priority and you may have to
give up some features for things to work on other editors.

## Contributing to this project

Please skim through [CONTRIBUTING.md](/CONTRIBUTING.md) if you plan to join on the fun.
