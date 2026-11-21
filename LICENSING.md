# Licensing

Compadr is published under three licenses, one per layer. Each package declares its license in the `license` field of its `package.json` and carries the full text in its own `LICENSE` or `LICENSE.md` file. The root of the repository is not a package and grants no license of its own.

| Layer | Packages | License |
|---|---|---|
| Format | `@compadr/format` | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) |
| Engine, command line, local MCP server, assist client | `@compadr/engine`, `@compadr/cli`, `@compadr/mcp`, `@compadr/assist` | [FSL-1.1-ALv2](https://fsl.software/) |
| Console | `@compadr/tokens`, `@compadr/console` | [FCL-1.0-ALv2](https://fcl.dev/) |

## What each license allows

- **Apache-2.0.** Any use, including in a commercial product. Other tools can read and write the Compadr format freely.
- **FSL-1.1-ALv2 (Functional Source License).** Any use except a Competing Use: a commercial product or service that substitutes for Compadr or offers substantially similar functionality. Internal use, use in continuous integration, education, research and professional services are permitted.
- **FCL-1.0-ALv2 (Fair Core License).** The same terms as the FSL. In addition, features protected by a license key may not be unlocked by changing, disabling or circumventing the key.

Under the FSL and the FCL, each version becomes available under the Apache License 2.0 on the second anniversary of the date it was made available.

## Boundary between the layers

A package depends only on packages of its own layer or of a more permissive one. The format never imports the engine, and the engine never imports the console. The check runs in CI (`tools/check-license-boundary.mjs`).

## Dependencies

Every dependency uses a permissive license or the file-level MPL-2.0. Strong copyleft licenses (GPL, LGPL, AGPL) are refused. The check runs in CI (`tools/check-licenses.mjs`).

## Trademarks

None of these licenses grants a right to the Compadr name or logo. The logo files in `packages/tokens/assets` are covered by [TRADEMARK.md](TRADEMARK.md), not by the license of the package.

Copyright 2026 Design Horizon & Development.
