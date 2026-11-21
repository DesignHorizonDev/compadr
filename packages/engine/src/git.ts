import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { programPath } from './program.ts'

const execFileAsync = promisify(execFile)

/**
 * The only git subcommands the engine may run. The engine never writes to the
 * repository it analyses: adding a subcommand here needs a review of
 * everything it can write.
 */
export const READ_ONLY_SUBCOMMANDS = [
  'blame',
  'diff',
  'grep',
  'log',
  'ls-tree',
  'merge-base',
  'rev-parse',
  'show',
] as const

export type ReadOnlySubcommand = (typeof READ_ONLY_SUBCOMMANDS)[number]

// Options that let a read-only subcommand write a file or start a program.
const FORBIDDEN_OPTIONS = [
  '--output',
  '--open-files-in-pager',
  '--ext-diff',
  '--textconv',
]

// Real git options that are also the start of a forbidden option.
const ALLOWED_PREFIXES = new Set(['--text'])

export class GitCommandRejectedError extends Error {
  override name = 'GitCommandRejectedError'
}

/** A git command that ran and exited with an unexpected code. */
export class GitCommandFailedError extends Error {
  override name = 'GitCommandFailedError'
  readonly exitCode: number | null
  readonly stderr: string

  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message)
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

export interface RunGitOptions {
  /**
   * Exit codes that still count as a result, besides 0. `git grep` exits with
   * 1 when nothing matches.
   */
  okExitCodes?: readonly number[]
}

interface ExecFileError {
  code?: number | string
  stdout?: string
  stderr?: string
}

function isForbiddenOption(arg: string): boolean {
  // `-O` is the short form of `--open-files-in-pager` for `git grep`.
  if (arg.startsWith('-O')) return true
  const name = arg.split('=', 1)[0]!
  if (!name.startsWith('--') || ALLOWED_PREFIXES.has(name)) return false
  // `git grep` accepts any unambiguous abbreviation of a long option, so
  // `--open-files=cat` runs `cat`. A prefix of a forbidden option is refused.
  return FORBIDDEN_OPTIONS.some(
    option => name.length > 3 && option.startsWith(name)
  )
}

function checkCommand(
  subcommand: ReadOnlySubcommand,
  args: readonly string[]
): void {
  if (!(READ_ONLY_SUBCOMMANDS as readonly string[]).includes(subcommand)) {
    throw new GitCommandRejectedError(
      `git ${subcommand} is not a read-only subcommand`
    )
  }
  // `git diff` runs the program of `diff.external` and the filters of
  // `textconv` unless it is told not to. `gitArgs` adds these options too:
  // a caller that names them states that its output depends on them.
  if (
    subcommand === 'diff' &&
    !(args.includes('--no-ext-diff') && args.includes('--no-textconv'))
  ) {
    throw new GitCommandRejectedError(
      'git diff needs --no-ext-diff and --no-textconv'
    )
  }
  const forbidden = args.find(isForbiddenOption)
  if (forbidden !== undefined) {
    throw new GitCommandRejectedError(
      `git ${subcommand} ${forbidden} can write or run a program`
    )
  }
}

// Settings that the configuration of the analysed repository could turn
// into a program: the program that checks a signature in `git log` and
// `git show`, and the fsmonitor hook. An empty ignoreRevsFile drops the file
// that the configuration may name.
const NEUTRAL_CONFIG = [
  '-c',
  'log.showSignature=false',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'blame.ignoreRevsFile=',
]

// Options added to each subcommand that can run a textconv filter or an
// external diff program of the configuration.
const NEUTRAL_OPTIONS: Partial<Record<ReadOnlySubcommand, readonly string[]>> =
  {
    blame: ['--no-textconv'],
    diff: ['--no-ext-diff', '--no-textconv'],
    log: ['--no-ext-diff', '--no-textconv', '--no-show-signature'],
    show: ['--no-ext-diff', '--no-textconv', '--no-show-signature'],
  }

function gitArgs(
  repoPath: string,
  subcommand: ReadOnlySubcommand,
  args: readonly string[]
): string[] {
  return [
    '--no-pager',
    ...NEUTRAL_CONFIG,
    '-C',
    repoPath,
    subcommand,
    ...(NEUTRAL_OPTIONS[subcommand] ?? []),
    ...args,
  ]
}

// Without optional locks, git does not refresh the index of the analysed
// repository.
const GIT_ENV = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
}

function failure(
  subcommand: ReadOnlySubcommand,
  exitCode: number | null,
  stderr: string
): GitCommandFailedError {
  return new GitCommandFailedError(
    `git ${subcommand} failed: ${stderr.trim()}`,
    exitCode,
    stderr
  )
}

/**
 * Runs a read-only git subcommand in `repoPath` and returns its standard
 * output. Throws `GitCommandRejectedError` before running anything when the
 * subcommand or one of its options could change the repository or the
 * workstation.
 */
export async function runGit(
  repoPath: string,
  subcommand: ReadOnlySubcommand,
  args: readonly string[] = [],
  options: RunGitOptions = {}
): Promise<string> {
  checkCommand(subcommand, args)
  try {
    const { stdout } = await execFileAsync(
      programPath('git'),
      gitArgs(repoPath, subcommand, args),
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: GIT_ENV }
    )
    return stdout
  } catch (error) {
    const { code, stdout, stderr } = error as ExecFileError
    if (typeof code === 'number' && options.okExitCodes?.includes(code)) {
      return stdout ?? ''
    }
    throw failure(
      subcommand,
      typeof code === 'number' ? code : null,
      stderr ?? String(error)
    )
  }
}

/**
 * Runs a read-only git subcommand like `runGit`, but hands each line of the
 * standard output to `onLine` instead of keeping the whole output in memory.
 * The memory used no longer depends on the size of the repository.
 */
export function forEachGitLine(
  repoPath: string,
  subcommand: ReadOnlySubcommand,
  args: readonly string[],
  onLine: (line: string) => void,
  options: RunGitOptions = {}
): Promise<void> {
  checkCommand(subcommand, args)
  return new Promise((resolve, reject) => {
    const child = spawn(
      programPath('git'),
      gitArgs(repoPath, subcommand, args),
      {
        env: GIT_ENV,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // The start of the error output is enough to explain a failure.
      if (stderr.length < 64 * 1024) stderr += chunk
    })
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', onLine)
    // The last line reaches `onLine` before the reader closes.
    const linesRead = new Promise(done => lines.once('close', done))
    child.on('error', error => reject(failure(subcommand, null, String(error))))
    child.on('close', code => {
      void linesRead.then(() => {
        if (
          code === 0 ||
          (code !== null && options.okExitCodes?.includes(code))
        ) {
          resolve()
        } else {
          reject(failure(subcommand, code, stderr))
        }
      })
    })
  })
}

const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

/**
 * The change of a pull request: the unified diff from the commit where `head`
 * leaves `base` to `head`, as GitHub shows it. Both are commit hashes, which
 * the caller resolves first.
 */
export function changeBetween(
  repoPath: string,
  base: string,
  head: string
): Promise<string> {
  if (!COMMIT.test(base) || !COMMIT.test(head)) {
    throw new GitCommandRejectedError('changeBetween needs two commit hashes')
  }
  return runGit(repoPath, 'diff', [
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    `${base}...${head}`,
  ])
}
