<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/tokens/assets/logo-dark.svg">
    <img alt="Compadr" src="packages/tokens/assets/logo-light.svg" width="320">
  </picture>
</h1>

<p align="center">Know what was decided, and whether the code still follows it.</p>

Compadr links each architecture decision record (ADR) to the code it governs, reports when the code moves away from it, and gives your coding agents the decisions in force before they write. The git repository stays the source of truth.

- **Drift you can trust.** Compadr dates each reference to the code. Only certain problems fail the check: a cited path that is gone, or a superseded decision that the code still cites.
- **A check on each pull request.** With `--base`, a pull request fails on what it adds, and not on the history it starts from.
- **A memory for your agents.** A local MCP server gives an agent the decisions that apply to a file, each with a one-sentence rule.
- **One page per feature.** The local console groups the decisions by feature and shows the rules in force after a chain of amendments.

Compadr reads adr-tools, MADR and Log4brains records as they are.

## Install

```bash
npm install --save-dev @compadr/cli
npx compadr --help
```

The command line needs Node 24 and git.

## First steps

```bash
# Report what no longer holds
npx compadr drift . --out /tmp/drift.json

# Fail a pull request on the problems that it adds
npx compadr check . --base origin/main

# Give the decisions to Claude Code
claude mcp add compadr -- npx compadr mcp .
```

The [documentation](https://compadr.io/docs/) covers the check in CI, the anchored references, the features, the MCP server and the console. The [reference](docs/reference.md) describes every command and file.

## Compadr never writes to your working copy

The engine only reads the repository that it analyses. A command that corrects a record works in a temporary clone, commits on a new branch and pushes it only when you ask for it. Nothing leaves your machine unless you push a draft or turn on the AI option in `compadr.yml`.

## Packages

| Package | Role | License |
|---|---|---|
| [`@compadr/format`](packages/format) | Decision record format: `compadr:` fields, supported ADR dialects, JSON schemas of the reports | Apache-2.0 |
| [`@compadr/engine`](packages/engine) | Deterministic, read-only drift engine | FSL-1.1-ALv2 |
| [`@compadr/cli`](packages/cli) | `compadr` command line | FSL-1.1-ALv2 |
| [`@compadr/mcp`](packages/mcp) | Local MCP server for coding agents | FSL-1.1-ALv2 |
| [`@compadr/assist`](packages/assist) | Client of the assist service of the AI option | FSL-1.1-ALv2 |
| [`@compadr/tokens`](packages/tokens) | Design tokens of the console: colors, fonts, radii, logo and favicon | FCL-1.0-ALv2 |
| [`@compadr/console`](packages/console) | Local web console of the drift reports | FCL-1.0-ALv2 |

npm publishes `@compadr/cli`, `@compadr/console` and `@compadr/format`. The command line and the console bundle the other packages.

The team portal and the hosted service are commercial products, and their code is not in this repository. The [pricing page](https://compadr.io/pricing/) describes them.

## Licenses

The format is under the Apache License 2.0. The engine, the command line, the MCP server and the assist client are under the Functional Source License (FSL-1.1-ALv2). The console and its design tokens are under the Fair Core License (FCL-1.0-ALv2). Under the FSL and the FCL, each version becomes available under the Apache License 2.0 two years after its release.

[LICENSING.md](LICENSING.md) explains what each license allows. [TRADEMARK.md](TRADEMARK.md) covers the name and the logo.

## Contributing

Questions and bugs go to the [issues](https://github.com/DesignHorizonDev/compadr/issues). [CONTRIBUTING.md](CONTRIBUTING.md) describes how to build the repository and how to propose a change. [SECURITY.md](SECURITY.md) describes how to report a vulnerability.
