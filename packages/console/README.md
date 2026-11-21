# @compadr/console

`compadr-console` serves the Compadr console on the decisions of one or more git repositories. The server reads each repository at a git reference and never writes to it. The corrections made in the pages go to a local draft, kept in the cache folder, that `compadr draft publish` turns into one pull request.

```bash
npm install --save-dev @compadr/cli @compadr/console
npx compadr-console ../my-repo --ref main
```

The console opens on `http://127.0.0.1:4180`. It shows the drift of the decisions, the links to repair, the features and the decisions of each file. The [documentation](https://compadr.io/docs/) describes each page. Questions and bugs go to the [issues](https://github.com/DesignHorizonDev/compadr/issues) or to contact@compadr.io.

| Option | Role | Default |
|---|---|---|
| `--ref` | Git reference to follow | `HEAD` |
| `--adr-dir` | Folder of the decision records | `docs/adr` |
| `--port`, `--host` | Address to listen on | `4180`, `127.0.0.1` |
| `--cache-dir` | Folder of the reports on disk, outside the repositories | `$XDG_CACHE_HOME/compadr` or `~/.cache/compadr` |
| `--no-cache` | Keep the reports in memory only | |
| `--no-github` | Do not ask `gh` for the pull requests of the branches under review | |

The server computes a drift report again only when the commit of the reference changes. It shares its folder of reports with `compadr mcp`. The console needs Node 24 and git.

## Plain language

With `COMPADR_ASSIST_URL` and `COMPADR_ASSIST_TOKEN` in its environment, the console gives the page of each decision the button "Read in plain language". The server sends the record to the assist service only when a person clicks, and each new version costs. It keeps each version by the service and the text of the record, in `<cache-dir>/plain/` (in memory with `--no-cache`). To ask for a new version of a record that did not change, for example after an update of the service, delete that folder. A record that `assist.exclude` of `compadr.yml` names never leaves the machine. The routes are `GET /api/assist`, and `GET` or `POST /api/assist/:id/plain/:n`. Keep `--host` on this machine: another machine that reaches the port could ask for versions at your cost, and the console warns at start.

## License

The console is under the Fair Core License, Version 1.0, ALv2 Future License (`LICENSE.md`). Each version becomes available under the Apache License 2.0 two years after its release. `THIRD_PARTY_NOTICES.md` gives the license of each package that the bundle includes.
