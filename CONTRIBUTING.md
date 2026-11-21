# Contributing to Compadr

Thank you for your interest in Compadr. This page describes how to report a problem, how to build the repository and how to propose a change.

## Questions and bugs

Open an [issue](https://github.com/DesignHorizonDev/compadr/issues). A bug report gives the version of the command line (`npx compadr --version`), the command that you ran and what it printed. Remove any private content of your repository from the report.

A security problem does not go to the issues: [SECURITY.md](SECURITY.md) describes how to report it.

## Contributor license agreement

Before we can merge your first pull request, you sign the [contributor license agreement](CLA.md). A bot asks for the signature in the pull request: you sign by posting the sentence that it gives. The signature covers all your later contributions.

The agreement lets Design Horizon & Development publish your contribution under the licenses of the repository, which change over time: each version under the FSL or the FCL becomes available under the Apache License 2.0 two years after its release. You keep the copyright of your contribution.

## Development

Requirements: Node 24 (see `.nvmrc`) and Corepack.

```bash
corepack enable
yarn install
yarn check
```

| Command | Effect |
|---|---|
| `yarn lint` | ESLint and Prettier |
| `yarn typecheck` | TypeScript in every package |
| `yarn test` | Vitest in every package |
| `yarn test:tools` | Tests of the repository tools |
| `yarn check:licenses` | Licenses of the installed dependencies |
| `yarn check:boundary` | License boundary between the packages |
| `yarn check:publication` | Nothing private in the files or the commit addresses |
| `yarn build` | Builds the command line into `packages/cli/dist` and the console into `packages/console/dist` |
| `yarn workspace @compadr/console dev` | Serves the console with live reload, and the reports of `COMPADR_REPORTS_DIR` |

## Pull requests

- One pull request covers one change. Open an issue first for a large change, so that we can agree on the approach.
- `yarn check` passes before you ask for a review.
- Code, comments and messages are in English.
- A commit message follows the Conventional Commits format: `fix(engine): …`, `feat(cli): …`, `docs: …`.
- A new dependency uses a permissive license. `yarn check:licenses` refuses the GPL, the LGPL and the AGPL.
- A package depends only on packages of its own license layer or of a more permissive one (`yarn check:boundary`, [LICENSING.md](LICENSING.md)).

## Releases

The command line (`@compadr/cli`), the console (`@compadr/console`) and the format (`@compadr/format`) are published on npm. The packages stay `private` in this workspace: only the archives that `tools/pack.mjs` builds and checks reach npm.

- The command line and the console are bundles. Each archive holds one bundle, the license of the package, and `THIRD_PARTY_NOTICES.md` with the license of every package that the bundle includes. The manifest of the archive declares no dependency.
- The format is a library. Its archive holds the built module, its type declarations, the JSON schemas, `LICENSE` and `NOTICE`. Its manifest declares `zod` and `yaml`.

```bash
yarn build
node tools/pack.mjs packs
```

The script reads each archive back and fails when a file, a notice, a license text or the `repository` field is missing, or when a manifest declares `private`. CI runs it on every pull request.

A release publishes the archives from a tag, with the workflow `Publish` (`.github/workflows/publish.yml`):

1. Raise the version of the three packages, update the changelog, merge, and tag the merge commit (`v0.4.0`).
2. Run `Publish` with the tag, `publish` off: the run builds the archives at the tag and runs `npm publish --dry-run` on each one.
3. Run `Publish` again with `publish` on. A maintainer approves the environment `npm`, then the run publishes `@compadr/format`, `@compadr/cli` and `@compadr/console`.

A run that stops after the first package can run again: it leaves the versions already on npm as they are.

npm authenticates the run by trusted publishing: no token is stored. npm adds the provenance of each package, which links it to the tag and the run that built it.
