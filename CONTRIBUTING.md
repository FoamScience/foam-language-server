# Contributing to OpenFOAM LSP

First of all, Thanks for taking the time to contribute!!

The following is a set of guidelines for contributing to the LSP implementation
for OpenFOAM dictionaries and related packages. These are mostly guidelines, not rules.
Use your best judgment, and feel free to propose changes to this document in a pull request.

## What should I know before I get started

### Code of Conduct

Examples of behavior that contributes to creating a positive environment include:

- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

Examples of unacceptable behavior by participants include:

- The use of sexualized language or imagery and unwelcome sexual attention or advances
- Trolling, insulting/derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information, such as a physical or electronic address, without explicit permission
- Other conduct which could reasonably be considered inappropriate in a professional setting

### Writing an LSP

An implementation of a language server protocol will run inside a text editor,
hence we strive to use only technology that "just works" on key presses and is
fast enough for users to not feel any lag-ish behavior.

However, efficiency is not everything, as we need to support multiple platforms
and environments. While we're improving the performance of our code, it's best
to stay clear of all techniques which would lead to a platform, or a specific
text editor, being left behind.

## How Can I Contribute?

### Reporting bugs

This section guides you through submitting a bug report. Following these guidelines
helps maintainers and the community understand your report, reproduce the behavior,
and find related reports quickly.

#### Before submitting bug reports

Before creating bug reports, please check:

- You're using **the latest version** of the LSP and related packages.
- **Check the** [discussions](https://github.com/FoamScience/foam-language-server/discussions) for a list of common questions and problems.
- **Perform a** [cursory search](https://github.com/search?q=+is%3Aissue+user%3Afoamscience)
  to see if the problem has already been reported. If it has and the issue is still open, 
  add a comment to the existing issue instead of opening a new one.

#### How Do I Submit A Good Bug Report? 

Bugs are tracked as [GitHub issues](https://github.com/FoamScience/foam-language-server/issues). If you decide that submitting a bug report
is necessary, create an issue on [this repository](https://github.com/FoamScience/foam-language-server/issues)
and provide the following information by filling in [the template](https://github.com/FoamScience/foam-language-server/blob/master/.github/ISSUE_TEMPLATE/bug_report.md).

### Adding/Modifying documentation

Non-programs are most welcome to contribute by documenting new OpenFOAM
keywords, code snippets and even signature helps.

All you need to do is to follow the examples provided at the 
[Markdown docs](server/foamfile-language-service/foamMarkdown.ts) and
the [PlainText docs](server/foamfile-language-service/foam-language-server.ts) and add your own to both files.

Then you can issue a pull request with a `documentation` flag.

> Note that documentation for signature help is present only as Plain Text

### Pull Requests

Please follow these steps to have your contribution considered by the maintainers:

0. Only request pulls to the `develop` branch
1. Follow all instructions in the template
2. Follow the [styleguides](CONTRIBUTING.md#Styleguides)
3. After you submit your pull request, verify that all status checks are passing
4. What if the status checks are failing?


If a status check is failing, and you believe that the failure is unrelated to your change, please leave a comment on the pull request explaining why you believe the failure is unrelated. A maintainer will re-run the status check for you. If we conclude that the failure was a false positive, then we will open an issue to track that problem with our status check suite.

While the prerequisites above must be satisfied prior to having your pull request reviewed, the reviewer(s) may ask you to complete additional design work, tests, or other changes before your pull request can be ultimately accepted.

## Styleguides

### Git commit history

- Please keep git history linear at all times. Specifically, you're not allowed to force-push to 
  the master branch.
- All PRs are to be opened against the `develop` branch.
- Limit the first line in a commit message to 72 characters or less
- Reference issues and pull requests liberally after the first line

### TypeScript/C++ style guidelines

This section is not yet complete.
