// `compadr-console`: serves the console on the decisions of git repositories.
import { chmodSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import type { Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import type { AssistClient } from '@compadr/assist'
import { GitCommandFailedError, runGit, type LocateWasm } from '@compadr/engine'
import packageJson from '../package.json' with { type: 'json' }
import { consoleServer } from './http.ts'
import { checkDraftName } from '@compadr/cli/drafts'
import { commitLookup } from './attribution.ts'
import { openPullRequests } from './pull-requests.ts'
import {
  consolidationInFolder,
  findingsInFolder,
  recommendationInFolder,
} from '../dev/reports-api.ts'
import { consoleDraftDecision } from './draft-decision.ts'
import { consolePlain } from './plain.ts'
import { repositoryReports } from './repository-reports.ts'

export interface Output {
  out: (line: string) => void
  err: (line: string) => void
}

export interface ConsoleOptions {
  /** Folder of the built pages. */
  pages: string
  locateWasm?: LocateWasm
  /** The environment, for the address and the token of the assist service. */
  env?: Readonly<Record<string, string | undefined>>
  /** Builds the client of the assist service; the tests give a fake one. */
  assistClient?: (url: string, token: string) => AssistClient
  /** The date of a drafted record; now by default. Tests fix it. */
  now?: () => Date
}

export const DEFAULT_PORT = 4180

const USAGE = `Usage: compadr-console <repository>... [options]

Serves the Compadr console on the decisions of one or more git repositories.
The server reads each repository at a git reference, without writing to it.
It computes the drift report again only when the commit of the reference
changes, and keeps the reports of the last commits on disk.

The Reviews page lists the branches that add or change a decision record
with the status "proposed". With the GitHub CLI (gh), it names their open
pull request. A record or a check without a declared name goes to the
people who approved, or else merged, the pull request of its commit, and
otherwise to the author of the commit.

The actions of correction of the pages, such as "Mark as checked", add their
commit to a local draft: a branch of a clone kept in the cache folder. The
repositories are never written, and nothing leaves the machine. Publish the
draft as one pull request with compadr draft publish.

The Drift page shows the findings of a semantic check, when --findings-dir
holds a file <repository>.findings.json for the repository, as compadr check
--semantic --findings writes it. A finding is a suggestion of a model. The page
of a proposed decision n shows the recommendation of the file
<repository>.accept-<n>.json of the same folder, as compadr assist accept
--out writes it. A person accepts the decision, in the local draft. The page
of a declared feature shows the rules in force of the file
<repository>.consolidate-<n>.json, as compadr assist consolidate --decision <n>
--out writes it for its main decision n. A person validates them, in the local
draft.

With COMPADR_ASSIST_URL and COMPADR_ASSIST_TOKEN, the page of a decision has
the button "Read in plain language". It sends the record to the assist
service, which writes a version in plain language. Each new version costs.
The server keeps each version by the service and the text of the record, in
the folder plain of the cache folder, and never sends a record that
assist.exclude of compadr.yml names.

With the same settings and a local draft, the Reviews page lists the branches
that change the code without proposing a record, with the button "Draft a
decision from this change". It sends the change of the branch to the assist
service, which drafts a record with the status proposed. The server writes the
record into a new local draft propose-<branch> that starts at the tip of the
branch: its pull request goes into the branch. Each new draft costs. The
server keeps the outcome for the commit of the branch, in the folder
draft-decision of the cache folder, and never sends a file that
assist.exclude names.

Options:
  --ref <ref>        Git reference to follow (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --port <port>      Port to listen on (default: ${DEFAULT_PORT})
  --host <host>      Address to listen on (default: 127.0.0.1)
  --cache-dir <dir>  Folder of the reports on disk, outside the repositories
                     (default: $XDG_CACHE_HOME/compadr or ~/.cache/compadr)
  --no-cache         Keep the reports in memory only
  --draft <name>     Name of the local draft that the actions of correction
                     fill (default: console)
  --no-draft         Give the commands of the corrections instead of
                     filling a local draft
  --no-github        Do not ask gh for pull requests: the branches under
                     review show no pull request, and the names come from
                     the records and the commit authors only
  --findings-dir <dir>
                     Folder of the findings of compadr check --semantic, of
                     the recommendations of compadr assist accept and of the
                     rules of compadr assist consolidate, read at each
                     request and never written
  -h, --help         Show this help
  -v, --version      Show the version number`

class UsageError extends Error {}

/** An address that only this machine reaches. */
function isLoopback(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  )
}

function checkName(name: string): string {
  try {
    return checkDraftName(name)
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
}

/** The same folder as `compadr mcp`, so that both share the reports. */
function defaultCacheDir(): string {
  // The XDG specification ignores a relative path.
  const xdg = process.env.XDG_CACHE_HOME
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.cache')
  const folder = join(base, 'compadr')
  // The cache holds reports and clones of the repositories: the other
  // accounts of the machine do not read it.
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  chmodSync(folder, 0o700)
  return folder
}

/** Real path of `folder`, or of its nearest parent that exists. */
function realFolder(folder: string): string {
  let current = resolve(folder)
  while (!existsSync(current)) current = dirname(current)
  return realpathSync(current)
}

function isInside(folder: string, root: string): boolean {
  const path = relative(root, folder)
  return (
    path === '' ||
    (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  )
}

function parsePort(text: string): number {
  const port = Number(text)
  if (!/^\d+$/.test(text) || port > 65535) {
    throw new UsageError(`--port ${text} is not a port number`)
  }
  return port
}

/**
 * Starts the server and returns it, or returns the exit code when the
 * command stops before serving.
 */
export async function runConsole(
  argv: readonly string[],
  output: Output,
  options: ConsoleOptions
): Promise<Server | number> {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        ref: { type: 'string' },
        'adr-dir': { type: 'string' },
        port: { type: 'string' },
        host: { type: 'string' },
        'cache-dir': { type: 'string' },
        'no-cache': { type: 'boolean' },
        'no-github': { type: 'boolean' },
        draft: { type: 'string' },
        'no-draft': { type: 'boolean' },
        'findings-dir': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    })
    if (values.help) {
      output.out(USAGE)
      return 0
    }
    if (values.version) {
      output.out(packageJson.version)
      return 0
    }
    if (positionals.length === 0) {
      throw new UsageError('compadr-console needs at least one repository')
    }
    if (values['no-cache'] && values['cache-dir'] !== undefined) {
      throw new UsageError('--no-cache does not go with --cache-dir')
    }
    const port =
      values.port === undefined ? DEFAULT_PORT : parsePort(values.port)
    const cacheDir = values['no-cache']
      ? undefined
      : resolve(values['cache-dir'] ?? defaultCacheDir())
    if (values['no-draft'] && values.draft !== undefined) {
      throw new UsageError('--no-draft does not go with --draft')
    }
    const draftName = values['no-draft']
      ? null
      : checkName(values.draft ?? 'console')
    // The drafts stay on disk, in the cache folder, even with --no-cache.
    const draftsDir = resolve(values['cache-dir'] ?? defaultCacheDir())
    const ref = values.ref ?? 'HEAD'
    const repositories: string[] = []
    for (const positional of positionals) {
      const repository = resolve(positional)
      const root = (
        await runGit(repository, 'rev-parse', ['--show-toplevel'])
      ).trim()
      // The reports and the drafts never land in a repository that the
      // server reads.
      for (const folder of [
        cacheDir,
        draftName === null ? undefined : draftsDir,
      ]) {
        if (
          folder !== undefined &&
          isInside(realFolder(folder), realpathSync(root))
        ) {
          throw new UsageError(
            `--cache-dir ${folder} is inside the repository ${repository}`
          )
        }
      }
      const commit = await runGit(
        repository,
        'rev-parse',
        ['--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
        { okExitCodes: [1] }
      )
      if (commit.trim() === '') {
        output.err(`compadr-console: ${ref} is not a commit of ${repository}`)
        return 1
      }
      repositories.push(repository)
    }
    const findingsDir =
      values['findings-dir'] === undefined
        ? undefined
        : resolve(values['findings-dir'])
    const reports = repositoryReports(
      repositories.map(repository => ({
        repository,
        ref,
        adrDir: values['adr-dir'],
        generatorVersion: packageJson.version,
        locateWasm: options.locateWasm,
        cacheDir,
      })),
      {
        ...(values['no-github']
          ? {}
          : {
              pullRequests: openPullRequests,
              commitPullRequest: commitLookup(),
            }),
        ...(draftName === null
          ? {}
          : {
              drafts: {
                name: draftName,
                cacheDir: draftsDir,
                ...(findingsDir === undefined
                  ? {}
                  : {
                      consolidation: (id: string, decision: number) =>
                        consolidationInFolder(findingsDir, id, decision),
                    }),
              },
            }),
      }
    )
    if (findingsDir !== undefined) {
      reports.findings = id => findingsInFolder(findingsDir, id)
      reports.recommendation = (id, decision) =>
        recommendationInFolder(findingsDir, id, decision)
      reports.consolidation = (id, decision) =>
        consolidationInFolder(findingsDir, id, decision)
    }
    const env = options.env ?? process.env
    const assistUrl = env.COMPADR_ASSIST_URL ?? ''
    const assistToken = env.COMPADR_ASSIST_TOKEN ?? ''
    if (assistUrl !== '' && assistToken === '') {
      output.err(
        'compadr-console: COMPADR_ASSIST_TOKEN is missing, so the pages do not ask the assist service'
      )
    } else if (assistUrl !== '') {
      let plain
      try {
        plain = consolePlain({
          url: assistUrl,
          token: assistToken,
          cacheDir,
          client: options.assistClient,
        })
      } catch (error) {
        throw new UsageError((error as Error).message)
      }
      reports.plain = {
        async cached(id, decision) {
          const source = await reports.recordSource(id)
          return source && plain.cached(source, decision)
        },
        async read(id, decision) {
          const source = await reports.recordSource(id)
          return source && plain.read(source, decision)
        },
      }
      output.err(
        `compadr-console: "Read in plain language" asks the assist service at ${assistUrl}, and each new version costs`
      )
      const drafts = reports.drafts
      if (drafts !== null) {
        const drafting = consoleDraftDecision({
          url: assistUrl,
          token: assistToken,
          drafts,
          cacheDir,
          client: options.assistClient,
          now: options.now,
        })
        reports.draftDecision = {
          async cached(id) {
            const source = await reports.branchSource(id)
            return source && drafting.cached(source)
          },
          async draft(id, actor) {
            const source = await reports.branchSource(id)
            return source && drafting.draft(source, actor)
          },
        }
        output.err(
          'compadr-console: "Draft a decision from this change" sends the change of a branch to the assist service, and each new draft costs'
        )
      }
    }
    // Open to the network, the console asks for a token: another machine
    // that reaches the port could otherwise read the decisions and add
    // commits to the drafts.
    const open = !isLoopback(values.host ?? '127.0.0.1')
    const token = open ? randomBytes(24).toString('base64url') : undefined
    if (open) {
      output.err(
        `compadr-console: warning: the console listens on ${values.host}. Another machine that reaches the port needs the token of the printed address to read the repositories${assistUrl === '' ? '' : ' and ask the assist service, at your cost'}`
      )
    }
    reports.warm()
    const host = values.host ?? '127.0.0.1'
    const server = consoleServer(
      options.pages,
      reports,
      message => output.err(`compadr-console: ${message}`),
      host,
      reports.drafts,
      token
    )
    await new Promise<void>((done, fail) => {
      server.once('error', fail)
      server.listen(port, host, () => {
        server.off('error', fail)
        done()
      })
    })
    const address = server.address()
    const shown = typeof address === 'object' && address ? address.port : port
    const where = host.includes(':') ? `[${host}]` : host
    const query = token === undefined ? '' : `/?token=${token}`
    output.out(
      `compadr-console: http://${where}:${shown}${query} serves ${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'} at ${ref}`
    )
    return server
  } catch (error) {
    if (error instanceof UsageError || isParseArgsError(error)) {
      output.err(`compadr-console: ${(error as Error).message}`)
      output.err(USAGE)
      return 2
    }
    if (error instanceof GitCommandFailedError) {
      output.err(`compadr-console: ${error.message}`)
      return 1
    }
    // The server could not listen: the port is taken, refused, or the
    // address is not one of this machine.
    if ((error as { syscall?: unknown }).syscall === 'listen') {
      output.err(`compadr-console: ${(error as Error).message}`)
      return 1
    }
    throw error
  }
}

function isParseArgsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_')
}
