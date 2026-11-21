# Security policy

## Supported versions

We fix security problems in the latest published version of `@compadr/cli`, `@compadr/console` and `@compadr/format`.

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Report it with a [private security advisory](https://github.com/DesignHorizonDev/compadr/security/advisories/new) of this repository, or by email to contact@compadr.io.

Give the version, the steps that reproduce the problem and its effect. We answer within 5 business days, and we tell you when a fix is published. We credit the reporter in the advisory, unless the reporter prefers otherwise.

## Scope

This policy covers the code of this repository: the format, the engine, the command line, the MCP server, the assist client and the console. The hosted service at app.compadr.io and the assist service at assist.compadr.io are also in scope: report a problem with them in the same way.

The engine only reads the repositories that it analyses, and runs a fixed list of git subcommands. A way to make it write to an analysed repository, run another program or read a file outside the repository is a vulnerability.

The correction commands (`index`, `map`, `agents`, `anchor`, `mark-checked`, `features --plan` and the drafts) write only in a clone that Compadr owns, outside the analysed repository. They build each commit from git objects and never check out the analysed tree. A way to make them write outside that clone, or run a program named by the analysed repository, is also a vulnerability.
