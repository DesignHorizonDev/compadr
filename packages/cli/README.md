# @compadr/cli

`compadr` keeps architecture decision records (ADRs) true to the code. It reads a git repository at one reference and never writes to it: the commands that change records write on a new branch of a temporary clone.

```bash
npm install --save-dev @compadr/cli
npx compadr --help
```

The [documentation](https://compadr.io/docs/) covers the check in CI, the anchored references, the features, the MCP server and the console. Questions and bugs go to the [issues](https://github.com/DesignHorizonDev/compadr/issues) or to contact@compadr.io.

| Command | Role |
|---|---|
| `compadr check <repository>` | Exits with 1 when the decisions have a certain problem. With `--base`, only the problems that the base does not have count. With `--diff`, only the problems of a change count. Notices on the rules of the decisions (`compadr.rule`, `compadr.yml`) and on the length of the records never fail it. |
| `compadr drift <repository>` | Writes the drift report of the repository as JSON. |
| `compadr decisions <repository> <file>` | Lists the decisions that apply to a file. |
| `compadr coverage <repository>` | Shows the zones of the code and how much the decisions in force reach them. |
| `compadr mcp <repository>` | Serves the decisions to coding agents over MCP (stdio). |
| `compadr index <repository>` | Writes the index of the decisions in force, on a new branch. |
| `compadr map <repository>` | Writes the memory card for coding agents, on a new branch. |
| `compadr agents <repository>` | Writes the excerpt for coding agents in `AGENTS.md`, on a new branch. |
| `compadr anchor <repository>` | Anchors references on symbols, on a new branch. |
| `compadr mark-checked <repository>` | Records that references were checked against the code, on a new branch. |
| `compadr features <repository>` | Plans the features, then writes them on a new branch. |
| `compadr draft <command> <repository>` | Lists, shows, publishes or discards the local drafts that the commands above fill with `--draft <name>`. |
| `compadr console <repository>...` | Runs `compadr-console`, from `@compadr/console`, when it is installed. |

Each command explains its options with `--help`. The command line needs Node 24 and git.

## In GitHub Actions

```yaml
- uses: actions/checkout@<sha>
  with:
    fetch-depth: 0
- run: npx compadr check . --base origin/${{ github.base_ref }} --format github
```

## License

The command line is under the Functional Source License, Version 1.1, ALv2 Future License (`LICENSE.md`). Each version becomes available under the Apache License 2.0 two years after its release. `THIRD_PARTY_NOTICES.md` gives the license of each package that the bundle includes.
