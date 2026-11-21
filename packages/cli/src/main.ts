import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { parseArgs } from 'node:util'
import {
  ASSIST_KINDS,
  AnchorEditError,
  decisionsForFile,
  FeatureGlossaryError,
  FrontmatterEditError,
  normalizeRepositoryPath,
  type DriftReport,
} from '@compadr/format'
import { formatCoverage } from './coverage-command.ts'
import { formatFileDecisions } from './decisions-command.ts'
import { buildRulesCorrection, RulesCommandError } from './rules-command.ts'
import {
  buildProposeCorrection,
  ProposeCommandError,
} from './propose-command.ts'
import {
  buildAcceptRequest,
  buildCheckRequest,
  buildConsolidateRequest,
  buildDraftRequest,
  buildPlainRequest,
  checkChange,
  checkNotices,
  checkReport,
  changeBetween,
  createDriftReport,
  AgentsExcerptError,
  generatedFilePaths,
  generatedFileProblems,
  newProblems,
  GitCommandFailedError,
  parseUnifiedDiff,
  runGit,
  type LocateWasm,
} from '@compadr/engine'
import { serveStdio } from '@compadr/mcp'
import {
  AssistServiceError,
  httpAssistClient,
  runAssist,
  semanticCheck,
  semanticFindings,
  withoutExcluded,
  type AssistClient,
  type SemanticCheck,
} from '@compadr/assist'
import packageJson from '../package.json' with { type: 'json' }
import { AnchorCommandError, buildCorrection } from './anchor-command.ts'
import {
  buildCheckedCorrection,
  CheckedCommandError,
} from './checked-command.ts'
import {
  agentsFile,
  buildAgentsCorrection,
  buildIndexCorrection,
  buildMapCorrection,
  GeneratedFileUpToDateError,
} from './generated-command.ts'
import {
  CHECK_FORMATS,
  changeProblems,
  formatSemanticCheck,
  semanticComment,
  formatChangeCheck,
  formatCheck,
  type CheckFormat,
} from './check-command.ts'
import {
  CONSOLE_PROGRAM,
  launchProgram,
  ProgramNotFoundError,
  type ProgramLauncher,
} from './console-command.ts'
import {
  buildFeatureCorrection,
  FeaturesCommandError,
  formatFeaturePlan,
  parseFeaturePlan,
} from './features-command.ts'
import { DraftError, DraftStore, type Draft } from './draft.ts'
import {
  discardDraft,
  DRAFT_SUBCOMMANDS,
  listDrafts,
  publishDraft,
  showDraft,
  type DraftSubcommand,
} from './draft-command.ts'
import {
  publish,
  PublishError,
  runCommand,
  type CommandRunner,
  type Correction,
} from './publish.ts'

export interface Output {
  out: (line: string) => void
  err: (line: string) => void
}

export interface MainOptions {
  /** Where the tree-sitter `.wasm` files are, when they are not installed. */
  locateWasm?: LocateWasm
  /** Runs git and gh for `compadr anchor`. Tests replace it. */
  run?: CommandRunner
  /** Starts the console program for `compadr console`. Tests replace it. */
  launch?: ProgramLauncher
  /** Reads the standard input for `compadr check --diff -`. Tests replace it. */
  readStdin?: () => Promise<string>
  /** Environment of `compadr assist` and `check --semantic`. Tests replace it. */
  env?: Record<string, string | undefined>
  /** Day of a validation, YYYY-MM-DD, for `compadr rules`. Tests replace it. */
  today?: () => string
  /** Builds the client of `compadr assist` and `check --semantic`. Tests give a fake client. */
  assistClient?: (url: string, token: string) => AssistClient
}

const USAGE = `Usage: compadr <command> [options]

Commands:
  drift <repository>   Write the drift report of a repository as JSON
  check <repository>   Fail when the decisions have a certain problem
  index <repository>   Write the index of the decisions in force, on a new branch
  map <repository>     Write the memory card for coding agents, on a new branch
  agents <repository>  Write the excerpt for coding agents, on a new branch
  anchor <repository>  Anchor references on symbols, on a new branch
  mark-checked <repository>
                       Record that references were checked, on a new branch
  features <repository>
                       Plan the features, then write them on a new branch
  rules <repository>   Validate the rules in force that the assist service
                       consolidated for a feature
  draft <command> <repository> [name]
                       List, show, publish or discard the local drafts
  decisions <repository> <file>
                       List the decisions that apply to a file
  coverage <repository>
                       Show the zones of the code that the decisions reach
  mcp <repository>     Serve the decisions to coding agents over MCP (stdio)
  console <repository>...
                       Serve the console on the decisions of repositories
  assist <kind> <repository>
                       Ask an assist service for a suggestion, and check it

Options:
  -h, --help     Show this help
  -v, --version  Show the version number`

const DRIFT_USAGE = `Usage: compadr drift <repository> [options]

Reads the repository at one git reference, without writing to it, and writes
its drift report as JSON.

Options:
  --ref <ref>        Git reference to analyse (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --name <name>      Name shown in the report (default: folder name)
  --out <file>       File to write, outside the repository (default: stdout)
  --draft <name>     Analyse the tip of a local draft instead of --ref
  --cache-dir <dir>  Folder of the drafts (default: $XDG_CACHE_HOME/compadr
                     or ~/.cache/compadr)
  -h, --help         Show this help`

const DRAFT_USAGE = `Usage: compadr draft <command> <repository> [name] [options]

A draft gathers corrections of the decision records before a single pull
request. Each correction command adds a commit to it with --draft <name>:
index, agents, anchor, mark-checked and features --plan. The first one
creates the draft at --ref; the next ones read the records at the tip of the
draft, so that each correction sees the previous ones. The draft is a branch
of a clone that Compadr keeps in its cache folder: the analysed repository
is never written.

Commands:
  list <repository>          List the drafts of the repository
  show <repository> <name>   Show the commits of a draft, its changed files,
                             and the drift signals it resolves or adds
  publish <repository> <name>
                             Push the draft to the origin remote, and open
                             a pull request with --open-pr
  discard <repository> <name>
                             Delete the draft

Options:
  --cache-dir <dir>  Folder of the drafts (default: $XDG_CACHE_HOME/compadr
                     or ~/.cache/compadr)
  --adr-dir <dir>    Folder of the decision records, for show
                     (default: docs/adr)
  --branch <name>    Branch to push, for publish (default: compadr/<name>)
  --title <text>     Pull request title, for publish (default: the subject of
                     a single commit, or a count of the corrections)
  --body <text>      Pull request body, for publish
  --open-pr          Open a pull request with gh after the push
  --base <branch>    Branch the pull request targets (default: the branch of
                     the --ref that created the draft)
  --github <o/name>  GitHub repository, when origin does not name one
  -h, --help         Show this help

Example:
  compadr mark-checked . --reference 0023:src/pool.ts:1 --draft review
  compadr index . --draft review
  compadr draft show . review
  compadr draft publish . review --open-pr`

const CHECK_USAGE = `Usage: compadr check <repository> [options]

Reads the repository at one git reference, without writing to it, and exits
with code 1 when its decisions have a certain problem: a broken drift signal
(a cited path or symbol that no longer exists, a superseded or unknown
decision cited by the code, a status that differs from the index), a status
that Compadr cannot read, a superseded decision that names no valid
successor, or, when the repository declares features, a decision that
belongs to none. Probable drift never fails the check.

The rule policy of compadr.yml, in the folder of the records, decides how
the rule of a decision (compadr.rule) counts. With "preferred", the default,
a decision in force without a rule that stands alone gets a notice, which
does not fail the check. With "required", a decision in force without
compadr.rule fails it. With "derived", nothing is said. A compadr.yml that
cannot be read fails the check.

With --base, only the problems that the base reference does not have count:
a pull request fails on what it adds, not on the history it starts from.

With --diff, the command checks a change before it is committed: a unified
diff against --ref, read from a file or from the standard input (-). It fails
when the change removes or moves a path that a decision cites, or cites a
superseded or unknown decision. Cited lines that the change modifies are
only to review. The problems that the repository already has do not count.

With --semantic, the command also asks the assist service whether the change
(--diff, or the commits since --base) breaks a decision in force. It sends
nothing unless assist.semantic is true in compadr.yml, and never the paths
of assist.exclude. The address of the service comes from $COMPADR_ASSIST_URL
and its token from $COMPADR_ASSIST_TOKEN. Each finding is a notice that cites
the rule: it never fails the check, and the exit code stays that of the
deterministic check. With --comment, the command also writes the findings as
the Markdown of a pull request comment, when something was sent. With
--findings, it writes them as JSON for the console, when the service
answered: name the file <report>.findings.json next to the reports.

Options:
  --ref <ref>        Git reference to check (default: HEAD)
  --base <ref>       Git reference whose problems do not count
  --diff <file>      Unified diff against --ref to check, or - for the
                     standard input
  --semantic         Also ask the assist service, when compadr.yml allows it
  --comment <file>   With --semantic: write the pull request comment there,
                     outside the repository
  --findings <file>  With --semantic: write the findings as JSON there, for
                     the console, outside the repository
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --format <format>  text, or github for annotations in GitHub Actions
                     (default: text)
  -h, --help         Show this help

Example, as a step of a GitHub Actions job (fetch-depth: 0):
  npx compadr check . --base origin/\${{ github.base_ref }} --format github

Example, on the changes of the working tree:
  git diff HEAD | npx compadr check . --diff -

Example, with the semantic check in a pull request:
  npx compadr check . --base origin/\${{ github.base_ref }} --format github \\
    --semantic --comment "$RUNNER_TEMP/compadr-comment.md"`

const INDEX_USAGE = `Usage: compadr index <repository> [options]

Writes INDEX.md in the folder of the decision records: the decisions in
force, by feature, in the language of the records. The change is committed on
a new branch of a temporary clone: the working copy of the repository is
never written. Without --push, the command shows the change and keeps
nothing. compadr check fails when the index no longer matches the records.

Options:
  --ref <ref>        Git reference to start from (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --branch <name>    Name of the new branch
  --title <text>     Commit message and pull request title
  --body <text>      Rest of the commit message and pull request body
  --draft <name>     Add the change to a local draft instead of a new
                     branch: see compadr draft
  --cache-dir <dir>  Folder of the drafts (default: $XDG_CACHE_HOME/compadr
                     or ~/.cache/compadr)
  --push             Push the branch to the origin remote
  --open-pr          Push the branch and open a pull request with gh
  --base <branch>    Branch the pull request targets (default: from --ref)
  --github <o/name>  GitHub repository, when origin does not name one
  -h, --help         Show this help`

const MAP_USAGE = `Usage: compadr map <repository> [options]

Writes MAP.md in the folder of the decision records: the memory card that a
coding agent reads once per session. It gives the features with the rule of
their main decision, the zones of the code with three linked files or more
and their decisions, and the other decisions in force, in the language of the
records. The change is committed on a new branch of a temporary clone: the
working copy of the repository is never written. Without --push, the command
shows the change and keeps nothing. compadr check fails when the card no
longer matches the records and the code.

Options:
  --ref <ref>        Git reference to start from (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --branch <name>    Name of the new branch
  --title <text>     Commit message and pull request title
  --body <text>      Rest of the commit message and pull request body
  --draft <name>     Add the change to a local draft instead of a new
                     branch: see compadr draft
  --cache-dir <dir>  Folder of the drafts (default: $XDG_CACHE_HOME/compadr
                     or ~/.cache/compadr)
  --push             Push the branch to the origin remote
  --open-pr          Push the branch and open a pull request with gh
  --base <branch>    Branch the pull request targets (default: from --ref)
  --github <o/name>  GitHub repository, when origin does not name one
  -h, --help         Show this help`

const AGENTS_USAGE = `Usage: compadr agents <repository> [options]

Writes the Compadr excerpt in the instructions of coding agents: where the
decisions are, how to read those of a file, and the features with their main
decision. The excerpt sits between two markers and replaces the previous one.
The change is committed on a new branch of a temporary clone. Without --push,
the command shows the change and keeps nothing. compadr check fails when the
excerpt no longer matches the records.

Options:
  --file <path>      File that receives the excerpt (default: AGENTS.md, or
                     CLAUDE.md when only that one exists)
  --ref <ref>        Git reference to start from (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --branch <name>    Name of the new branch
  --title <text>     Commit message and pull request title
  --body <text>      Rest of the commit message and pull request body
  --draft <name>     Add the change to a local draft instead of a new
                     branch: see compadr draft
  --cache-dir <dir>  Folder of the drafts (default: $XDG_CACHE_HOME/compadr
                     or ~/.cache/compadr)
  --push             Push the branch to the origin remote
  --open-pr          Push the branch and open a pull request with gh
  --base <branch>    Branch the pull request targets (default: from --ref)
  --github <o/name>  GitHub repository, when origin does not name one
  -h, --help         Show this help`

const ANCHOR_USAGE = `Usage: compadr anchor <repository> --reference <id> [options]

Replaces references that cite line numbers by the anchors that the drift
report proposes (path#Symbol), and records their fingerprints. The change is
committed on a new branch of a temporary clone: the working copy of the
repository is never written. Without --push, the command shows the change
and keeps nothing.

Options:
  --reference <id>   Reference to anchor, as in the report (repeatable)
  --ref <ref>        Git reference to start from (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --with-lines       Also track the cited lines, when they were found
  --branch <name>    Name of the new branch
  --title <text>     Commit message and pull request title
  --body <text>      Rest of the commit message and pull request body
  --draft <name>     Add the change to a local draft instead of a new
                     branch: see compadr draft
  --cache-dir <dir>  Folder of the drafts (default: $XDG_CACHE_HOME/compadr
                     or ~/.cache/compadr)
  --push             Push the branch to the origin remote
  --open-pr          Push the branch and open a pull request with gh
  --base <branch>    Branch the pull request targets (default: from --ref)
  --github <o/name>  GitHub repository, when origin does not name one
  -h, --help         Show this help`

const MARK_CHECKED_USAGE = `Usage: compadr mark-checked <repository> --reference <id> [options]

Records that a person checked references of the decision records against the
code at --ref. Each record receives, in compadr.checked, the date of that
commit for each reference, and the name of the person who checked: the drift
signals of the reference start from that date, until the code changes again.
The change is committed on a new branch of a
temporary clone: the working copy of the repository is never written.
Without --push, the command shows the change and keeps nothing.

Options:
  --reference <id>   Reference checked, as in the report (repeatable)
  --by <name>        Person who checked (default: git config user.name)
  --ref <ref>        Git reference that was checked (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --branch <name>    Name of the new branch
  --title <text>     Commit message and pull request title
  --body <text>      Rest of the commit message and pull request body
  --draft <name>     Add the change to a local draft instead of a new
                     branch: see compadr draft
  --cache-dir <dir>  Folder of the drafts (default: $XDG_CACHE_HOME/compadr
                     or ~/.cache/compadr)
  --push             Push the branch to the origin remote
  --open-pr          Push the branch and open a pull request with gh
  --base <branch>    Branch the pull request targets (default: from --ref)
  --github <o/name>  GitHub repository, when origin does not name one
  -h, --help         Show this help`

const FEATURES_USAGE = `Usage: compadr features <repository> [options]

Without --plan, writes the features of the repository as a YAML plan: the
features it declares, or a grouping that Compadr proposes. Edit the plan,
then pass it with --plan: each record of a feature receives compadr.feature
and compadr.parent, and features.yml in the ADR folder receives the labels.
The change is committed on a new branch of a temporary clone: the working
copy of the repository is never written. Without --push, the command shows
the change and keeps nothing.

Options:
  --ref <ref>        Git reference to start from (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --out <file>       File for the plan, outside the repository (default: stdout)
  --plan <file>      Plan to write on a new branch
  --branch <name>    Name of the new branch
  --title <text>     Commit message and pull request title
  --body <text>      Rest of the commit message and pull request body
  --draft <name>     Add the change to a local draft instead of a new
                     branch: see compadr draft
  --cache-dir <dir>  Folder of the drafts (default: $XDG_CACHE_HOME/compadr
                     or ~/.cache/compadr)
  --push             Push the branch to the origin remote
  --open-pr          Push the branch and open a pull request with gh
  --base <branch>    Branch the pull request targets (default: from --ref)
  --github <o/name>  GitHub repository, when origin does not name one
  -h, --help         Show this help`

const RULES_USAGE = `Usage: compadr rules <repository> --feature <id> --suggestion <file> [options]

Validates the rules in force of a feature. The rules come from the
suggestion that compadr assist consolidate wrote for its main decision.
A request names its commit, so the suggestion must come from the same
reference. The suggestion passes the guard again. The rules then go into
features.yml, under the feature, with the fingerprint of each record of
the chain. compadr check gives a notice when one of these records changes.
The change is committed on a new branch of a temporary clone, or added to
a local draft. Without --push or --draft, the command shows the change and
keeps nothing.

Options:
  --feature <id>     Feature whose rules to validate
  --suggestion <file>
                     Output of compadr assist consolidate --decision <main>
  --ref <ref>        Git reference to start from (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --branch <name>    Name of the new branch
  --title <text>     Commit message and pull request title
  --body <text>      Rest of the commit message and pull request body
  --draft <name>     Add the change to a local draft instead of a new
                     branch: see compadr draft
  --cache-dir <dir>  Folder of the drafts (default: $XDG_CACHE_HOME/compadr
                     or ~/.cache/compadr)
  --push             Push the branch to the origin remote
  --open-pr          Push the branch and open a pull request with gh
  --base <branch>    Branch the pull request targets (default: from --ref)
  --github <o/name>  GitHub repository, when origin does not name one
  -h, --help         Show this help

Example:
  compadr assist consolidate . --decision 34 --out /tmp/rules.json
  compadr rules . --feature atelier --suggestion /tmp/rules.json --draft console`

const DECISIONS_USAGE = `Usage: compadr decisions <repository> <file> [options]

Lists the decisions that apply to a file: those whose record cites the file
or one of its folders, and those that the file cites. A superseded decision
leads to the decisions that replace it. The file is a path in the
repository, or an absolute path inside its working copy.

Options:
  --ref <ref>        Git reference to analyse (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --json             Write the answer as JSON
  -h, --help         Show this help`

const MCP_USAGE = `Usage: compadr mcp <repository> [options]

Serves the decisions of a repository to coding agents, as a local MCP server
on the standard input and output. The tools are decisions_for_file,
check_change_against_decisions, get_decision, search_decisions and
propose_decision. The server only reads:
propose_decision returns a record that the agent writes in its own branch.
The drift report is computed when the server starts, then again only when
the commit of --ref changes. The reports of the last commits stay on disk, so
that a new server answers at once on a commit already analysed.

Options:
  --ref <ref>        Git reference to follow (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --cache-dir <dir>  Folder of the reports on disk, outside the repository
                     (default: $XDG_CACHE_HOME/compadr or ~/.cache/compadr)
  --no-cache         Keep the reports in memory only
  -h, --help         Show this help

Example, for Claude Code:
  claude mcp add compadr -- compadr mcp /path/to/repository`

const COVERAGE_USAGE = `Usage: compadr coverage <repository> [options]

Shows the zones of the code and how much the decisions in force reach them.
A zone is a folder of code files. A file is linked when the record of a
decision in force cites it, or when it cites the decision. A folder cited by a
record marks its zone without linking its files. Each zone is "strong" (half
of its files linked or more, one of them both ways), "partial" (15 % or
more), "thin", "folder-only" (only a cited folder) or "none". A zone without
decision is information, not a problem: the command always exits with 0.

Options:
  --ref <ref>        Git reference to analyse (default: HEAD)
  --adr-dir <dir>    Folder of the decision records (default: docs/adr)
  --json             Write the zones as JSON
  -h, --help         Show this help`

const ASSIST_USAGE = `Usage: compadr assist <kind> <repository> [options]

Kinds:
  check        Whether a change breaks a decision in force
  consolidate  The rules in force along the amendments of a decision
  plain        A decision in plain language
  draft        A draft record for a change
  accept       Whether to accept a proposed decision that the code cites

Builds the request from the drift report, without any model. With --request,
writes it and sends nothing. Otherwise, sends it to the assist service, checks
the suggestion with the guard, and writes what the guard accepts, with the
problems it found. A suggestion is never a decision: a person reviews it.

With --draft, draft writes the suggested record into a local draft instead,
with the status proposed: review it with compadr draft show, then publish it
with compadr draft publish. When the change only applies a decision in force,
the command says so and writes nothing.

Options:
  --ref <ref>          Git reference to analyse (default: HEAD)
  --adr-dir <dir>      Folder of the decision records (default: docs/adr)
  --diff <file>        check, draft: unified diff against --ref, or - for the
                       standard input
  --base <ref>         check, draft: the change from where --ref leaves <ref>
                       to --ref, as a pull request shows it
  --decision <number>  consolidate, plain, accept: number of the decision
  --draft <name>       draft: add the record to this local draft, created at
                       --ref when it does not exist (see compadr draft)
  --cache-dir <dir>    Folder of the drafts (default: $XDG_CACHE_HOME/compadr
                       or ~/.cache/compadr)
  --request            Write the request as JSON and send nothing
  --url <url>          Address of the assist service (default:
                       $COMPADR_ASSIST_URL)
  --out <file>         File to write, outside the repository (default: stdout,
                       or nothing with --draft)
  -h, --help           Show this help

The token of the service is read from $COMPADR_ASSIST_TOKEN only. Without an
address, the command says that nothing was sent and exits with 0.

Examples:
  compadr assist draft . --base main --draft review
  compadr assist check . --base main --out /tmp/findings.json`

const USAGES: Record<string, string> = {
  assist: ASSIST_USAGE,
  coverage: COVERAGE_USAGE,
  mcp: MCP_USAGE,
  decisions: DECISIONS_USAGE,
  drift: DRIFT_USAGE,
  check: CHECK_USAGE,
  index: INDEX_USAGE,
  map: MAP_USAGE,
  agents: AGENTS_USAGE,
  anchor: ANCHOR_USAGE,
  'mark-checked': MARK_CHECKED_USAGE,
  features: FEATURES_USAGE,
  rules: RULES_USAGE,
  draft: DRAFT_USAGE,
}

class UsageError extends Error {}

/** Real path of the folder that will hold `file`, or of its nearest parent. */
function realFolder(file: string): string {
  let folder = dirname(resolve(file))
  while (!existsSync(folder)) folder = dirname(folder)
  return realpathSync(folder)
}

function isSymbolicLink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

function isInside(folder: string, root: string): boolean {
  const path = relative(root, folder)
  return (
    path === '' ||
    (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  )
}

/**
 * The engine never writes to the repository it analyses, and neither does
 * the command line. A link would let the write land anywhere, even when it is
 * broken, so --out cannot be one.
 */
async function checkOutFile(repository: string, out: string): Promise<void> {
  if (isSymbolicLink(out)) {
    throw new UsageError(`--out ${out} is a symbolic link`)
  }
  const root = (
    await runGit(repository, 'rev-parse', ['--show-toplevel'])
  ).trim()
  if (isInside(realFolder(out), realpathSync(root))) {
    throw new UsageError(`--out ${out} is inside the analysed repository`)
  }
}

async function drift(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      ref: { type: 'string' },
      'adr-dir': { type: 'string' },
      name: { type: 'string' },
      out: { type: 'string' },
      draft: { type: 'string' },
      'cache-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    output.out(DRIFT_USAGE)
    return 0
  }
  if (positionals.length !== 1) {
    throw new UsageError('drift needs exactly one repository')
  }
  const repository = resolve(positionals[0]!)
  if (values.out !== undefined) await checkOutFile(repository, values.out)
  let read = { repository, ref: values.ref }
  if (values.draft !== undefined) {
    if (values.ref !== undefined) {
      throw new UsageError('--draft analyses the tip of the draft: drop --ref')
    }
    const store = await draftStore(repository, values['cache-dir'], options)
    const draft = await store.get(values.draft)
    if (draft === null) throw new DraftError(`no draft ${values.draft}`)
    read = { repository: store.clone, ref: draft.branch }
  }
  const report = await createDriftReport(read.repository, {
    ref: read.ref,
    adrDir: values['adr-dir'],
    name:
      values.name ??
      (values.draft === undefined ? undefined : basename(repository)),
    generatorVersion: packageJson.version,
    locateWasm: options.locateWasm,
  })
  if (report.decisions.length === 0) {
    output.err(
      `compadr drift: no decision record in ${report.repository.adrDir} at ${report.repository.ref}`
    )
    return 1
  }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (values.out === undefined) {
    output.out(json.trimEnd())
    return 0
  }
  try {
    writeFileSync(values.out, json)
  } catch (error) {
    output.err(
      `compadr drift: cannot write ${values.out}: ${(error as Error).message}`
    )
    return 1
  }
  const broken = report.signals.filter(s => s.level === 'broken').length
  output.err(
    `✔ ${values.out}: ${report.decisions.length} decisions, ${report.signals.length} signals (${broken} broken), commit ${report.repository.commit.slice(0, 8)}`
  )
  return 0
}

async function check(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      ref: { type: 'string' },
      base: { type: 'string' },
      diff: { type: 'string' },
      semantic: { type: 'boolean' },
      comment: { type: 'string' },
      findings: { type: 'string' },
      'adr-dir': { type: 'string' },
      format: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    output.out(CHECK_USAGE)
    return 0
  }
  for (const option of ['comment', 'findings'] as const) {
    if (values[option] !== undefined && !values.semantic) {
      throw new UsageError(`--${option} needs --semantic`)
    }
  }
  if (
    values.semantic &&
    values.diff === undefined &&
    values.base === undefined
  ) {
    throw new UsageError('--semantic needs the change: --diff or --base')
  }
  if (positionals.length !== 1) {
    throw new UsageError('check needs exactly one repository')
  }
  if (values.diff !== undefined && values.base !== undefined) {
    throw new UsageError('--diff and --base cannot be used together')
  }
  const format = values.format ?? 'text'
  if (!(CHECK_FORMATS as readonly string[]).includes(format)) {
    throw new UsageError(`--format ${format} is not one of text, github`)
  }
  const repository = resolve(positionals[0]!)
  for (const file of [values.comment, values.findings]) {
    if (file !== undefined) await checkOutFile(repository, file)
  }
  const ref = values.ref ?? 'HEAD'
  for (const [option, value] of [
    ['--ref', ref],
    ['--base', values.base],
  ] as const) {
    if (
      value !== undefined &&
      !(await refExists(repository, `${value}^{commit}`))
    ) {
      throw new UsageError(
        `${option} ${value} is not a commit of ${repository}`
      )
    }
  }
  const report = (at: string) =>
    createDriftReport(repository, {
      ref: at,
      adrDir: values['adr-dir'],
      generatorVersion: packageJson.version,
      locateWasm: options.locateWasm,
    })
  const head = await report(ref)
  if (head.decisions.length === 0) {
    output.err(
      `compadr check: no decision record in ${head.repository.adrDir} at ${ref}`
    )
    return 1
  }
  if (values.diff !== undefined) {
    const text = await readDiff(values.diff, options)
    // An empty diff is a change with nothing to check. A diff that reads as
    // no file is an error: passing would hide a failed `git diff`.
    if (text.trim() === '') {
      output.err('compadr check: the diff is empty, nothing was checked')
      return 0
    }
    const files = parseUnifiedDiff(text)
    if (files.length === 0) {
      throw new UsageError(
        `--diff ${values.diff} holds no file of a unified diff`
      )
    }
    const checked = changeProblems(head, checkChange(head, files))
    for (const line of formatChangeCheck(checked, {
      format: format as CheckFormat,
      files: files.length,
    })) {
      output.out(line)
    }
    if (values.semantic) {
      await semanticStep(head, text, format as CheckFormat, null)
    }
    return checked.problems.length === 0 ? 0 : 1
  }
  const problemsOf = async (report: DriftReport) => {
    const files = new Map<string, string>()
    for (const path of generatedFilePaths(report)) {
      const content = await fileAt(repository, report.repository.commit, path)
      if (content !== null) files.set(path, content)
    }
    return [...checkReport(report), ...generatedFileProblems(report, files)]
  }
  const all = await problemsOf(head)
  let problems = all
  let notices = checkNotices(head)
  let baseCommit: string | null = null
  if (values.base !== undefined) {
    const commit = (
      await runGit(repository, 'rev-parse', [
        '--verify',
        '--end-of-options',
        `${values.base}^{commit}`,
      ])
    ).trim()
    baseCommit = commit
    // A base on the same commit has the same problems: no second report.
    if (commit === head.repository.commit) {
      problems = []
      notices = []
    } else {
      const base = await report(values.base)
      problems = newProblems(all, await problemsOf(base))
      notices = newProblems(notices, checkNotices(base))
    }
  }
  for (const line of formatCheck(problems, {
    format: format as CheckFormat,
    total: all.length,
    base: values.base ?? null,
    notices,
  })) {
    output.out(line)
  }
  if (values.semantic && baseCommit !== null) {
    // Without the option, the change is not even read.
    const change =
      head.assist?.semantic === true
        ? await changeBetween(repository, baseCommit, head.repository.commit)
        : ''
    await semanticStep(head, change, format as CheckFormat, baseCommit)
  }
  return problems.length === 0 ? 0 : 1

  /**
   * Asks the assist service, prints its findings as notices, and writes the
   * comment. Whatever happens, the exit code stays that of the check.
   */
  async function semanticStep(
    report: DriftReport,
    change: string,
    checkFormat: CheckFormat,
    base: string | null
  ): Promise<void> {
    const env = options.env ?? process.env
    const result: SemanticCheck = await semanticCheck(report, change, {
      url: env.COMPADR_ASSIST_URL,
      token: env.COMPADR_ASSIST_TOKEN,
      client: options.assistClient,
    })
    for (const line of formatSemanticCheck(result, checkFormat)) {
      if (line.startsWith('◇')) output.err(line)
      else output.out(line)
    }
    // A file that cannot be built or written is said, and the exit code
    // stays that of the check.
    const files: [string | undefined, () => string | null][] = [
      [values.comment, () => semanticComment(result)],
      [values.findings, () => jsonText(semanticFindings(result, report, base))],
    ]
    for (const [file, build] of files) {
      if (file === undefined) continue
      try {
        const text = build()
        if (text !== null) writeFileSync(file, text)
      } catch (error) {
        output.err(
          `compadr check: cannot write ${file}: ${(error as Error).message}`
        )
      }
    }
  }
}

const jsonText = (value: unknown) =>
  value === null ? null : `${JSON.stringify(value, null, 2)}\n`

/** The diff of `compadr check --diff`: a file, or the standard input. */
async function readDiff(source: string, options: MainOptions): Promise<string> {
  if (source === '-') return (options.readStdin ?? readStandardInput)()
  try {
    return readFileSync(source, 'utf8')
  } catch (error) {
    throw new UsageError(
      `--diff ${source} cannot be read: ${(error as Error).message}`
    )
  }
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Content of a file at a commit, or null when the commit has no such file. */
async function fileAt(
  repository: string,
  commit: string,
  path: string
): Promise<string | null> {
  return (await refExists(repository, `${commit}:${path}`))
    ? runGit(repository, 'show', [`${commit}:${path}`])
    : null
}

async function refExists(repository: string, ref: string): Promise<boolean> {
  const output = await runGit(
    repository,
    'rev-parse',
    ['--verify', '--quiet', '--end-of-options', ref],
    { okExitCodes: [1] }
  )
  return output.trim() !== ''
}

/**
 * Branch that a pull request built from `ref` targets: the current branch for
 * HEAD, `x` for `origin/x`, or the local branch `ref`. A tag or a commit names
 * no branch.
 */
async function baseBranch(repository: string, ref: string): Promise<string> {
  if (ref === 'HEAD') {
    const branch = (
      await runGit(repository, 'rev-parse', ['--abbrev-ref', 'HEAD'])
    ).trim()
    if (branch === 'HEAD') {
      throw new UsageError('HEAD is detached: pass --base <branch>')
    }
    return branch
  }
  const remote = /^(?:refs\/remotes\/)?origin\/(.+)$/.exec(ref)?.[1]
  if (
    remote !== undefined &&
    (await refExists(repository, `refs/remotes/origin/${remote}`))
  ) {
    return remote
  }
  const local = ref.replace(/^refs\/heads\//, '')
  if (await refExists(repository, `refs/heads/${local}`)) return local
  throw new UsageError(`${ref} is not a branch: pass --base <branch>`)
}

async function anchor(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      reference: { type: 'string', multiple: true },
      'with-lines': { type: 'boolean' },
      ...PUBLISH_OPTIONS,
    },
  })
  if (values.help) {
    output.out(ANCHOR_USAGE)
    return 0
  }
  if (positionals.length !== 1) {
    throw new UsageError('anchor needs exactly one repository')
  }
  if (!values.reference || values.reference.length === 0) {
    throw new UsageError('anchor needs at least one --reference')
  }
  const repository = resolve(positionals[0]!)
  const target = await correctionTarget(repository, values, output, options)
  const report = await target.report()
  const correction = await buildCorrection(
    repository,
    report,
    {
      references: values.reference,
      withLines: values['with-lines'] ?? false,
      branch: values.branch,
      title: values.title,
      body: values.body,
    },
    file =>
      runGit(target.repository, 'show', [`${report.repository.commit}:${file}`])
  )
  return target.publish(correction)
}

/** `git config user.name` in the repository, or undefined when unset. */
async function userName(
  repository: string,
  options: MainOptions
): Promise<string | undefined> {
  try {
    const run = options.run ?? runCommand
    const name = (
      await run('git', ['config', '--get', 'user.name'], repository)
    ).trim()
    return name === '' ? undefined : name
  } catch {
    // git exits with 1 when the name is not set.
    return undefined
  }
}

async function markChecked(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      reference: { type: 'string', multiple: true },
      by: { type: 'string' },
      ...PUBLISH_OPTIONS,
    },
  })
  if (values.help) {
    output.out(MARK_CHECKED_USAGE)
    return 0
  }
  if (positionals.length !== 1) {
    throw new UsageError('mark-checked needs exactly one repository')
  }
  if (!values.reference || values.reference.length === 0) {
    throw new UsageError('mark-checked needs at least one --reference')
  }
  const repository = resolve(positionals[0]!)
  const target = await correctionTarget(repository, values, output, options)
  const report = await target.report()
  const commit = report.repository.commit
  // The date of the commit that was checked, as git blame dates the code. In
  // a draft, the code is that of its start: its commits change records only.
  const seconds = (
    await runGit(target.repository, 'log', [
      '-1',
      '--format=%ct',
      target.codeCommit ?? commit,
    ])
  ).trim()
  const correction = await buildCheckedCorrection(
    repository,
    report,
    {
      references: values.reference,
      at: `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19)}Z`,
      by: values.by?.trim() || (await userName(repository, options)),
      branch: values.branch,
      title: values.title,
      body: values.body,
    },
    file => runGit(target.repository, 'show', [`${commit}:${file}`])
  )
  return target.publish(correction)
}

interface PublishValues {
  ref?: string
  push?: boolean
  'open-pr'?: boolean
  branch?: string
  base?: string
  github?: string
  draft?: string
  'cache-dir'?: string
}

/** The drafts of a repository, under the cache folder. */
async function draftStore(
  repository: string,
  cacheDirOption: string | undefined,
  options: MainOptions
): Promise<DraftStore> {
  const cacheDir = resolve(cacheDirOption ?? defaultCacheDir())
  const root = (
    await runGit(repository, 'rev-parse', ['--show-toplevel'])
  ).trim()
  // The drafts never land in the repository that Compadr analyses.
  if (isInside(realFolder(join(cacheDir, 'drafts', 'x')), realpathSync(root))) {
    throw new UsageError(
      `--cache-dir ${cacheDir} is inside the analysed repository`
    )
  }
  return DraftStore.open(repository, cacheDir, options.run)
}

/** Where a correction reads the records, and where its commit goes. */
interface CorrectionTarget {
  /** The analysed repository, or the clone that holds the draft. */
  repository: string
  /** The report of the records that the correction changes. */
  report: () => Promise<DriftReport>
  /** In a draft, the commit whose code the draft keeps. */
  codeCommit: string | null
  /** Commits the correction, and returns the exit code. */
  publish: (correction: Correction) => Promise<number>
}

async function correctionTarget(
  repository: string,
  values: PublishValues & { 'adr-dir'?: string },
  output: Output,
  options: MainOptions,
  /** False when the command will not commit, so needs no pull request base. */
  commits = true,
  /** The store of the drafts, when the command has opened it already. */
  opened?: DraftStore
): Promise<CorrectionTarget> {
  const ref = values.ref ?? 'HEAD'
  const report = (at: string, ref: string) => () =>
    createDriftReport(at, {
      ref,
      adrDir: values['adr-dir'],
      name: basename(repository),
      generatorVersion: packageJson.version,
      locateWasm: options.locateWasm,
    })
  if (values.draft === undefined) {
    if (values['cache-dir'] !== undefined) {
      throw new UsageError('--cache-dir goes with --draft')
    }
    const openPullRequest = values['open-pr'] ?? false
    // The base only serves the pull request, and is checked before any push.
    const base =
      commits && openPullRequest
        ? (values.base ?? (await baseBranch(repository, ref)))
        : null
    return {
      repository,
      report: report(repository, ref),
      codeCommit: null,
      publish: correction =>
        publishCorrection(correction, values, base, output, options),
    }
  }
  for (const option of [
    'push',
    'open-pr',
    'branch',
    'base',
    'github',
  ] as const) {
    if (values[option] !== undefined) {
      throw new UsageError(
        `--${option} does not go with --draft: publish the draft with compadr draft publish`
      )
    }
  }
  const name = values.draft
  const store =
    opened ?? (await draftStore(repository, values['cache-dir'], options))
  const { draft, created } = await store.open(name, async () => {
    const commit = (
      await runGit(
        repository,
        'rev-parse',
        ['--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
        { okExitCodes: [1] }
      )
    ).trim()
    if (commit === '') throw new UsageError(`${ref} is not a commit`)
    // A draft from a tag or a commit has no base yet: publish asks for one.
    const branch = await baseBranch(repository, ref).catch(() => null)
    return { commit, baseBranch: branch }
  })
  if (!created && values.ref !== undefined) {
    throw new UsageError(
      `draft ${name} already starts at ${draft.base.slice(0, 8)}: --ref only applies to a new draft`
    )
  }
  return {
    repository: store.clone,
    report: report(store.clone, draft.branch),
    codeCommit: draft.base,
    publish: async correction => {
      output.out((await store.add(draft, correction)).trimEnd())
      const count = (await store.commits(draft)).length
      output.err(
        `✔ draft ${name}: ${count} ${count === 1 ? 'commit' : 'commits'}. Run compadr draft show ${repository} ${name} to review it, then compadr draft publish to push it.`
      )
      return 0
    },
  }
}

async function publishCorrection(
  correction: Correction,
  values: PublishValues,
  base: string | null,
  output: Output,
  options: MainOptions
): Promise<number> {
  const openPullRequest = values['open-pr'] ?? false
  const result = await publish(
    correction,
    {
      push: values.push ?? false,
      openPullRequest,
      base: base ?? '',
      github: values.github,
    },
    options.run
  )
  output.out(result.diff.trimEnd())
  if (result.pullRequest) {
    output.err(`✔ pull request ${result.pullRequest}`)
  } else if (result.pushedTo) {
    output.err(`✔ branch ${correction.branch} pushed to ${result.pushedTo}`)
  } else {
    output.err(
      `Nothing was pushed. Run again with --push or --open-pr to publish ${correction.branch}.`
    )
  }
  return 0
}

const PUBLISH_OPTIONS = {
  ref: { type: 'string' },
  'adr-dir': { type: 'string' },
  branch: { type: 'string' },
  title: { type: 'string' },
  body: { type: 'string' },
  push: { type: 'boolean' },
  'open-pr': { type: 'boolean' },
  base: { type: 'string' },
  github: { type: 'string' },
  draft: { type: 'string' },
  'cache-dir': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const

/** `compadr index` and `compadr agents`. */
async function generated(
  command: 'index' | 'map' | 'agents',
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      ...PUBLISH_OPTIONS,
      ...(command === 'agents' ? { file: { type: 'string' } } : {}),
    },
  })
  if (values.help) {
    output.out(USAGES[command]!)
    return 0
  }
  if (positionals.length !== 1) {
    throw new UsageError(`${command} needs exactly one repository`)
  }
  const repository = resolve(positionals[0]!)
  const target = await correctionTarget(repository, values, output, options)
  const report = await target.report()
  if (report.decisions.length === 0) {
    output.err(
      `compadr ${command}: no decision record in ${report.repository.adrDir} at ${report.repository.ref}`
    )
    return 1
  }
  const commit = report.repository.commit
  const request = {
    branch: values.branch,
    title: values.title,
    body: values.body,
  }
  try {
    let correction: Correction
    if (command === 'index' || command === 'map') {
      const build =
        command === 'index' ? buildIndexCorrection : buildMapCorrection
      const file = `${report.repository.adrDir}/${command === 'index' ? 'INDEX.md' : 'MAP.md'}`
      correction = build(
        repository,
        report,
        await fileAt(target.repository, commit, file),
        request
      )
    } else {
      const named = (values as { file?: string }).file
      const existing = new Map<string, string>()
      for (const file of [
        'AGENTS.md',
        'CLAUDE.md',
        ...(named ? [named] : []),
      ]) {
        const content = await fileAt(target.repository, commit, file)
        if (content !== null) existing.set(file, content)
      }
      const file = agentsFile(named, f => existing.has(f))
      correction = buildAgentsCorrection(
        repository,
        report,
        file,
        existing.get(file) ?? null,
        request
      )
    }
    return await target.publish(correction)
  } catch (error) {
    if (!(error instanceof GeneratedFileUpToDateError)) throw error
    output.err(`✔ ${error.message} at ${commit.slice(0, 8)}`)
    return 0
  }
}

async function features(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      out: { type: 'string' },
      plan: { type: 'string' },
      ...PUBLISH_OPTIONS,
    },
  })
  if (values.help) {
    output.out(FEATURES_USAGE)
    return 0
  }
  if (positionals.length !== 1) {
    throw new UsageError('features needs exactly one repository')
  }
  const repository = resolve(positionals[0]!)
  if (values.plan === undefined) {
    if (values.out !== undefined) await checkOutFile(repository, values.out)
  } else if (values.out !== undefined) {
    throw new UsageError('--out writes a plan: it does not go with --plan')
  }
  let planText: string | null = null
  if (values.plan !== undefined) {
    try {
      planText = readFileSync(values.plan, 'utf8')
    } catch (error) {
      output.err(
        `compadr features: cannot read ${values.plan}: ${(error as Error).message}`
      )
      return 1
    }
  }
  if (planText === null && values.draft !== undefined) {
    throw new UsageError(
      '--draft goes with --plan: the plan alone writes nothing'
    )
  }
  const target = await correctionTarget(
    repository,
    values,
    output,
    options,
    planText !== null
  )
  const report = await target.report()

  if (planText === null) {
    const plan = formatFeaturePlan(report)
    if (values.out === undefined) {
      output.out(plan.trimEnd())
      return 0
    }
    try {
      writeFileSync(values.out, plan)
    } catch (error) {
      output.err(
        `compadr features: cannot write ${values.out}: ${(error as Error).message}`
      )
      return 1
    }
    output.err(
      `✔ ${values.out}: ${report.features?.length ?? 0} features, commit ${report.repository.commit.slice(0, 8)}`
    )
    return 0
  }

  const commit = report.repository.commit
  const correction = await buildFeatureCorrection(
    repository,
    report,
    parseFeaturePlan(planText, report),
    { branch: values.branch, title: values.title, body: values.body },
    async file =>
      (await refExists(target.repository, `${commit}:${file}`))
        ? runGit(target.repository, 'show', [`${commit}:${file}`])
        : null
  )
  return target.publish(correction)
}

async function rules(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      feature: { type: 'string' },
      suggestion: { type: 'string' },
      ...PUBLISH_OPTIONS,
    },
  })
  if (values.help) {
    output.out(RULES_USAGE)
    return 0
  }
  if (positionals.length !== 1) {
    throw new UsageError('rules needs exactly one repository')
  }
  if (values.feature === undefined || values.suggestion === undefined) {
    throw new UsageError('rules needs --feature and --suggestion')
  }
  let json: unknown
  try {
    json = JSON.parse(readFileSync(values.suggestion, 'utf8'))
  } catch (error) {
    output.err(
      `compadr rules: cannot read ${values.suggestion}: ${(error as Error).message}`
    )
    return 1
  }
  const repository = resolve(positionals[0]!)
  const target = await correctionTarget(repository, values, output, options)
  const report = await target.report()
  const commit = report.repository.commit
  const show = (file: string) =>
    runGit(target.repository, 'show', [`${commit}:${file}`])
  const correction = await buildRulesCorrection(
    repository,
    report,
    values.feature,
    json,
    { branch: values.branch, title: values.title, body: values.body },
    show,
    async file =>
      (await refExists(target.repository, `${commit}:${file}`))
        ? show(file)
        : null,
    (options.today ?? (() => new Date().toISOString().slice(0, 10)))()
  )
  return target.publish(correction)
}

async function coverage(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      ref: { type: 'string' },
      'adr-dir': { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    output.out(COVERAGE_USAGE)
    return 0
  }
  if (positionals.length !== 1) {
    throw new UsageError('coverage needs exactly one repository')
  }
  const report = await createDriftReport(resolve(positionals[0]!), {
    ref: values.ref,
    adrDir: values['adr-dir'],
    generatorVersion: packageJson.version,
    locateWasm: options.locateWasm,
  })
  const { name, ref, commit } = report.repository
  if (values.json) {
    output.out(
      JSON.stringify(
        { repository: { name, ref, commit }, zones: report.zones ?? [] },
        null,
        2
      )
    )
  } else {
    for (const line of formatCoverage(report)) output.out(line)
  }
  return 0
}

async function decisions(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      ref: { type: 'string' },
      'adr-dir': { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    output.out(DECISIONS_USAGE)
    return 0
  }
  if (positionals.length !== 2) {
    throw new UsageError('decisions needs a repository and a file')
  }
  const repository = resolve(positionals[0]!)
  let file = positionals[1]!
  if (isAbsolute(file)) {
    const root = realpathSync(
      (await runGit(repository, 'rev-parse', ['--show-toplevel'])).trim()
    )
    const inside = relative(root, realFolder(file))
    if (!isInside(realFolder(file), root)) {
      throw new UsageError(`${file} is outside the repository`)
    }
    file = [inside, file.slice(file.lastIndexOf(sep) + 1)]
      .filter(part => part !== '')
      .join('/')
  }
  const path = normalizeRepositoryPath(file)
  const report = await createDriftReport(repository, {
    ref: values.ref,
    adrDir: values['adr-dir'],
    generatorVersion: packageJson.version,
    locateWasm: options.locateWasm,
  })
  const { commit, ref } = report.repository
  if (path === '' || !(await refExists(repository, `${commit}:${path}`))) {
    output.err(
      `compadr decisions: ${path || file} is not in the repository at ${ref}`
    )
    return 1
  }
  const answer = decisionsForFile(report, path)
  if (values.json) {
    output.out(
      JSON.stringify(
        {
          repository: { name: report.repository.name, ref, commit },
          ...answer,
        },
        null,
        2
      )
    )
  } else {
    output.out(formatFileDecisions(report, answer))
  }
  return 0
}

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

async function mcp(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      ref: { type: 'string' },
      'adr-dir': { type: 'string' },
      'cache-dir': { type: 'string' },
      'no-cache': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    output.out(MCP_USAGE)
    return 0
  }
  if (positionals.length !== 1) {
    throw new UsageError('mcp needs exactly one repository')
  }
  const repository = resolve(positionals[0]!)
  // The standard output carries the protocol: the checks write to stderr.
  // A server that starts on a missing reference would fail on every call.
  const root = (
    await runGit(repository, 'rev-parse', ['--show-toplevel'])
  ).trim()
  if (values['no-cache'] && values['cache-dir'] !== undefined) {
    throw new UsageError('--no-cache does not go with --cache-dir')
  }
  const cacheDir = values['no-cache']
    ? undefined
    : resolve(values['cache-dir'] ?? defaultCacheDir())
  // The reports never land in the repository that the server reads.
  if (
    cacheDir !== undefined &&
    isInside(realFolder(join(cacheDir, 'report.json')), realpathSync(root))
  ) {
    throw new UsageError(
      `--cache-dir ${cacheDir} is inside the analysed repository`
    )
  }
  const ref = values.ref ?? 'HEAD'
  if (!(await refExists(repository, `${ref}^{commit}`))) {
    output.err(`compadr mcp: ${ref} is not a commit of ${repository}`)
    return 1
  }
  await serveStdio({
    repository,
    ref,
    adrDir: values['adr-dir'],
    cacheDir,
    generatorVersion: packageJson.version,
    locateWasm: options.locateWasm,
  })
  output.err(`compadr mcp: serving ${repository} on stdio`)
  return 0
}

async function consoleCommand(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  try {
    return await (options.launch ?? launchProgram)(CONSOLE_PROGRAM, args)
  } catch (error) {
    if (!(error instanceof ProgramNotFoundError)) throw error
    output.err(
      `compadr console: ${CONSOLE_PROGRAM} is not installed: install @compadr/console next to @compadr/cli`
    )
    return 1
  }
}

async function draftCommand(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      'cache-dir': { type: 'string' },
      'adr-dir': { type: 'string' },
      branch: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
      'open-pr': { type: 'boolean' },
      base: { type: 'string' },
      github: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    output.out(DRAFT_USAGE)
    return 0
  }
  const [command, path, name, ...extra] = positionals
  if (!DRAFT_SUBCOMMANDS.includes(command as DraftSubcommand)) {
    throw new UsageError(
      command === undefined
        ? 'draft needs a command'
        : `${command} is not a draft command`
    )
  }
  const subcommand = command as DraftSubcommand
  if (path === undefined) {
    throw new UsageError(`draft ${subcommand} needs a repository`)
  }
  if (subcommand === 'list' ? name !== undefined : name === undefined) {
    throw new UsageError(
      subcommand === 'list'
        ? 'draft list takes no draft name'
        : `draft ${subcommand} needs a draft name`
    )
  }
  if (extra.length > 0) throw new UsageError(`unexpected ${extra[0]}`)
  const store = await draftStore(resolve(path), values['cache-dir'], options)
  if (subcommand === 'list') return listDrafts(store, output)
  if (subcommand === 'show') {
    return showDraft(
      store,
      name!,
      {
        adrDir: values['adr-dir'],
        generatorVersion: packageJson.version,
        locateWasm: options.locateWasm,
      },
      output
    )
  }
  if (subcommand === 'discard') return discardDraft(store, name!, output)
  return publishDraft(
    store,
    name!,
    {
      branch: values.branch,
      title: values.title,
      body: values.body,
      openPullRequest: values['open-pr'] ?? false,
      base: values.base,
      github: values.github,
    },
    output
  )
}

/** Runs the command line and returns the exit code. */
export async function main(
  argv: readonly string[],
  output: Output,
  options: MainOptions = {}
): Promise<number> {
  const [first, ...rest] = argv
  if (first === undefined || first === '-h' || first === '--help') {
    output.out(USAGE)
    return 0
  }
  if (first === '-v' || first === '--version') {
    output.out(packageJson.version)
    return 0
  }
  try {
    if (first === 'drift') return await drift(rest, output, options)
    if (first === 'check') return await check(rest, output, options)
    if (first === 'index' || first === 'map' || first === 'agents') {
      return await generated(first, rest, output, options)
    }
    if (first === 'anchor') return await anchor(rest, output, options)
    if (first === 'mark-checked') {
      return await markChecked(rest, output, options)
    }
    if (first === 'features') return await features(rest, output, options)
    if (first === 'rules') return await rules(rest, output, options)
    if (first === 'decisions') return await decisions(rest, output, options)
    if (first === 'coverage') return await coverage(rest, output, options)
    if (first === 'mcp') return await mcp(rest, output, options)
    if (first === 'console') return await consoleCommand(rest, output, options)
    if (first === 'draft') return await draftCommand(rest, output, options)
    if (first === 'assist') return await assist(rest, output, options)
  } catch (error) {
    if (error instanceof UsageError || isParseArgsError(error)) {
      output.err(`compadr ${first}: ${(error as Error).message}`)
      output.err(USAGES[first]!)
      return 2
    }
    if (
      error instanceof GitCommandFailedError ||
      error instanceof AnchorCommandError ||
      error instanceof PublishError ||
      error instanceof AnchorEditError ||
      error instanceof FeaturesCommandError ||
      error instanceof RulesCommandError ||
      error instanceof FeatureGlossaryError ||
      error instanceof FrontmatterEditError ||
      error instanceof CheckedCommandError ||
      error instanceof AgentsExcerptError ||
      error instanceof DraftError ||
      error instanceof AssistServiceError
    ) {
      output.err(`compadr ${first}: ${error.message}`)
      return 1
    }
    throw error
  }
  output.err(`compadr: unknown command or option "${first}"`)
  output.err(USAGE)
  return 2
}

async function assist(
  args: readonly string[],
  output: Output,
  options: MainOptions
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      ref: { type: 'string' },
      'adr-dir': { type: 'string' },
      diff: { type: 'string' },
      base: { type: 'string' },
      decision: { type: 'string' },
      draft: { type: 'string' },
      'cache-dir': { type: 'string' },
      request: { type: 'boolean' },
      url: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    output.out(ASSIST_USAGE)
    return 0
  }
  const [kind, target, ...extra] = positionals
  if (
    kind === undefined ||
    !(ASSIST_KINDS as readonly string[]).includes(kind)
  ) {
    throw new UsageError(
      `assist needs a kind: ${ASSIST_KINDS.join(', ')}${kind === undefined ? '' : ` (not ${kind})`}`
    )
  }
  if (target === undefined || extra.length > 0) {
    throw new UsageError('assist needs exactly one repository')
  }
  const readsChange = kind === 'check' || kind === 'draft'
  if (values.diff !== undefined && values.base !== undefined) {
    throw new UsageError('--diff and --base cannot be used together')
  }
  if (readsChange && values.diff === undefined && values.base === undefined) {
    throw new UsageError(`assist ${kind} needs the change: --diff or --base`)
  }
  if (!readsChange && (values.diff ?? values.base) !== undefined) {
    throw new UsageError(`assist ${kind} reads a decision, not a change`)
  }
  if (values.draft !== undefined && kind !== 'draft') {
    throw new UsageError('--draft goes with assist draft')
  }
  if (values.draft === undefined && values['cache-dir'] !== undefined) {
    throw new UsageError('--cache-dir goes with --draft')
  }
  if (values.draft !== undefined && values.request) {
    throw new UsageError('--request sends nothing, so it writes no draft')
  }
  let decision: number | null = null
  if (!readsChange) {
    if (values.decision === undefined || !/^\d{1,4}$/.test(values.decision)) {
      throw new UsageError(`assist ${kind} needs --decision <number>`)
    }
    decision = Number(values.decision)
  } else if (values.decision !== undefined) {
    throw new UsageError(`assist ${kind} reads a diff, not --decision`)
  }
  const repository = resolve(target)
  if (values.out !== undefined) await checkOutFile(repository, values.out)
  let ref = values.ref ?? 'HEAD'
  for (const [option, value] of [
    ['--ref', ref],
    ['--base', values.base],
  ] as const) {
    if (
      value !== undefined &&
      !(await refExists(repository, `${value}^{commit}`))
    ) {
      throw new UsageError(
        `${option} ${value} is not a commit of ${repository}`
      )
    }
  }
  let store: DraftStore | null = null
  let existing: Draft | null = null
  if (values.draft !== undefined) {
    // A draft keeps the code of the commit it started from: the change ends
    // there.
    store = await draftStore(repository, values['cache-dir'], options)
    existing = await store.get(values.draft)
    if (existing !== null && values.ref !== undefined) {
      throw new UsageError(
        `draft ${values.draft} already starts at ${existing.base.slice(0, 8)}: --ref only applies to a new draft`
      )
    }
    if (existing !== null) ref = existing.base
  }
  // The records come from the draft when it exists: the service and the
  // guard then see the records that an earlier run wrote there.
  const recordsRepository = existing === null ? repository : store!.clone
  const report = await createDriftReport(recordsRepository, {
    ref: existing === null ? ref : existing.branch,
    adrDir: values['adr-dir'],
    name: basename(repository),
    generatorVersion: packageJson.version,
    locateWasm: options.locateWasm,
  })
  // The last commit of the change, in the analysed repository.
  const head = existing?.base ?? report.repository.commit
  if (report.decisions.length === 0) {
    output.err(
      `compadr assist: no decision record in ${report.repository.adrDir} at ${ref}`
    )
    return 1
  }
  if (decision !== null && !report.decisions.some(d => d.number === decision)) {
    throw new UsageError(`--decision ${decision} is not a decision of ${ref}`)
  }
  if (
    kind === 'accept' &&
    report.decisions.find(d => d.number === decision)!.status !== 'proposed'
  ) {
    throw new UsageError(
      `assist accept reads a proposed decision, and ${decision} is ${report.decisions.find(d => d.number === decision)!.status}`
    )
  }
  let diff = ''
  let change: { base: string | null; head: string } = { base: null, head }
  if (readsChange && values.diff !== undefined) {
    diff = await readDiff(values.diff, options)
    if (parseUnifiedDiff(diff).length === 0) {
      throw new UsageError(
        `--diff ${values.diff} holds no file of a unified diff`
      )
    }
  } else if (readsChange) {
    const base = (
      await runGit(repository, 'rev-parse', [
        '--verify',
        '--end-of-options',
        `${values.base!}^{commit}`,
      ])
    ).trim()
    change = { base, head }
    diff = await changeBetween(repository, base, head)
    if (parseUnifiedDiff(diff).length === 0) {
      output.err(
        `compadr assist: ${values.base} and ${ref} hold the same files, nothing was sent`
      )
      return 0
    }
  }
  if (readsChange) {
    // The files that compadr.yml keeps in the repository never leave it.
    const kept = withoutExcluded(diff, report)
    if (kept.excluded.length > 0) {
      output.err(
        `◇ left out of the request, as assist.exclude of compadr.yml asks: ${kept.excluded.join(', ')}`
      )
    }
    if (parseUnifiedDiff(kept.diff).length === 0) {
      output.err(
        'compadr assist: every file of the change stays in the repository, nothing was sent'
      )
      return 0
    }
    diff = kept.diff
  }
  const readRecord = (file: string) =>
    runGit(recordsRepository, 'show', [`${report.repository.commit}:${file}`])
  // A path that a record cites whole is a file, or a folder that gives no
  // excerpt.
  const isFile = (path: string) =>
    runGit(recordsRepository, 'ls-tree', [
      report.repository.commit,
      '--',
      path,
    ]).then(listing => /^\d+ blob /.test(listing))
  const request =
    kind === 'check'
      ? buildCheckRequest(report, diff)
      : kind === 'draft'
        ? buildDraftRequest(report, diff)
        : kind === 'consolidate'
          ? await buildConsolidateRequest(report, decision!, readRecord)
          : kind === 'accept'
            ? await buildAcceptRequest(
                report,
                decision!,
                readRecord,
                {},
                isFile
              )
            : await buildPlainRequest(report, decision!, readRecord)

  const write = (value: unknown): number => {
    const json = `${JSON.stringify(value, null, 2)}\n`
    if (values.out === undefined) {
      if (values.draft === undefined) output.out(json.trimEnd())
      return 0
    }
    try {
      writeFileSync(values.out, json)
    } catch (error) {
      output.err(
        `compadr assist: cannot write ${values.out}: ${(error as Error).message}`
      )
      return 1
    }
    output.err(`✔ ${values.out}`)
    return 0
  }
  if (values.request) return write(request)

  const env = options.env ?? process.env
  const url = values.url ?? env.COMPADR_ASSIST_URL
  if (url === undefined || url === '') {
    output.err(
      'compadr assist: no assist service is configured (--url or COMPADR_ASSIST_URL), nothing was sent'
    )
    return 0
  }
  const token = env.COMPADR_ASSIST_TOKEN
  if (token === undefined || token === '') {
    throw new UsageError(
      'the token of the assist service is missing: set COMPADR_ASSIST_TOKEN'
    )
  }
  const client = (
    options.assistClient ??
    ((address, secret) => httpAssistClient({ url: address, token: secret }))
  )(url, token)
  const outcome = await runAssist(client, request, report)
  const errors = outcome.problems.filter(p => p.level === 'error').length
  const notices = outcome.problems.length - errors
  output.err(
    outcome.suggestion === null
      ? `compadr assist: the guard rejected the whole suggestion (${outcome.problems[0]?.message ?? ''})`
      : `compadr assist: ${outcome.rejected} item(s) rejected by the guard, ${notices} notice(s)`
  )
  const code = write(outcome)
  if (outcome.suggestion === null) return 1
  if (outcome.suggestion.kind !== 'draft') return code
  // A draft is read by a person: the notices of the guard come first.
  for (const problem of outcome.problems) {
    output.err(`◇ ${problem.item || 'suggestion'}: ${problem.message}`)
  }
  if (values.draft === undefined) return code
  const suggestion = outcome.suggestion
  if (suggestion.notNeeded !== null) {
    output.err(
      `compadr assist: the change needs no new record, so the draft is unchanged: ${suggestion.notNeeded}`
    )
    return code
  }
  if (code !== 0) return code
  const draftTarget = await correctionTarget(
    repository,
    {
      ref: values.ref,
      'adr-dir': values['adr-dir'],
      draft: values.draft,
      'cache-dir': values['cache-dir'],
    },
    output,
    options,
    true,
    store!
  )
  // The record follows the latest record of the draft, and takes the number
  // after the last one there. A new draft starts at the commit of the report,
  // so the report already holds the records of the draft.
  const latest = [...report.decisions].sort((a, b) => b.number - a.number)[0]
  const template =
    latest === undefined
      ? null
      : await runGit(draftTarget.repository, 'show', [
          `${report.repository.commit}:${latest.file}`,
        ]).catch(() => null)
  let built
  try {
    built = buildProposeCorrection(
      repository,
      // The reader knows the draft by its name, not by its branch.
      {
        ...report,
        repository: { ...report.repository, ref: `draft ${values.draft}` },
      },
      suggestion,
      change,
      template,
      (options.today ?? (() => new Date().toISOString().slice(0, 10)))()
    )
  } catch (error) {
    if (error instanceof ProposeCommandError) {
      output.err(`compadr assist: ${error.message}`)
      return 1
    }
    throw error
  }
  for (const note of built.record.notes) output.err(`◇ ${note}`)
  return draftTarget.publish(built.correction)
}

function isParseArgsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_')
}
