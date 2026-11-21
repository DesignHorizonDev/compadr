// Writes a correction of the decision records on a new branch, away from the
// analysed repository. The engine only reads; this module writes, and only in
// a temporary clone:
//
// - in the analysed repository it runs `git clone` (from it), `git fetch`
//   (from it) and `git config --get` (the author identity and the URL of
//   origin), which change nothing there;
// - in the temporary clone it builds the commit from git objects, without
//   checking out the tree of the analysed commit (see `commitFiles`), and
//   pushes it to the remote of the analysed repository;
// - `gh pr create` opens the pull request on GitHub.
//
// It never forces a push and never writes in the working copy of the
// analysed repository.
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Runs a program and returns its standard output. */
export type CommandRunner = (
  program: 'git' | 'gh',
  args: string[],
  cwd?: string,
  /** Variables added to the environment of the command only. */
  env?: Readonly<Record<string, string>>
) => Promise<string>

export const runCommand: CommandRunner = async (program, args, cwd, env) => {
  try {
    const { stdout } = await exec(program, args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    })
    return stdout
  } catch (error) {
    const { stderr } = error as { stderr?: unknown }
    const reason = typeof stderr === 'string' ? stderr.trim() : ''
    throw new PublishError(
      `${program} ${args[0]} failed${reason ? `: ${reason}` : ''}`
    )
  }
}

export interface Correction {
  /** Analysed repository. */
  repository: string
  /** Commit the branch starts from. */
  commit: string
  branch: string
  /** First line of the commit message and title of the pull request. */
  title: string
  /** Rest of the commit message and body of the pull request. */
  body: string
  /** New content of each record, by path in the repository. */
  files: Map<string, string>
}

export interface PublishOptions {
  push: boolean
  openPullRequest: boolean
  /** Branch the pull request targets. */
  base: string
  /** `owner/name` on GitHub; read from the remote URL when absent. */
  github?: string
}

export interface PublishResult {
  /** `git show --stat --patch` of the commit. */
  diff: string
  pushedTo: string | null
  pullRequest: string | null
}

export class PublishError extends Error {}

/** `owner/name` of a GitHub remote URL, or null. */
export function githubRepository(url: string): string | null {
  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
      url.trim()
    )
  return match ? match[1]! : null
}

/**
 * The URL of the origin remote of the analysed repository. The push runs in
 * a clone of Compadr: a relative path, which git reads from the repository,
 * becomes an absolute one.
 */
export async function originUrl(
  repository: string,
  run: CommandRunner
): Promise<string> {
  const url = (
    await run('git', [
      '-C',
      repository,
      'config',
      '--get',
      'remote.origin.url',
    ]).catch(() => '')
  ).trim()
  if (url === '') throw new PublishError(`${repository} has no origin remote`)
  // git would read such a URL as an option of `git push`.
  if (url.startsWith('-')) {
    throw new PublishError(`${url} is not a remote URL`)
  }
  // `scheme://…` and `host:path` stay as they are.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url) || /^[^/]+:/.test(url)) {
    return url
  }
  if (isAbsolute(url)) return url
  const root = (
    await run('git', ['-C', repository, 'rev-parse', '--show-toplevel'])
  ).trim()
  return resolve(root, url)
}

/**
 * The `-c user.name=… -c user.email=…` options of the analysed repository. A
 * clone of Compadr sits outside the `includeIf` rules of the user: its
 * commits take the identity of the analysed repository.
 */
export async function commitIdentity(
  repository: string,
  run: CommandRunner
): Promise<string[]> {
  const identity: string[] = []
  for (const key of ['user.name', 'user.email']) {
    const value = (
      await run('git', ['-C', repository, 'config', '--get', key]).catch(
        () => ''
      )
    ).trim()
    if (value !== '') identity.push('-c', `${key}=${value}`)
  }
  return identity
}

/**
 * A path of a correction: relative to the root of the repository, without
 * an empty, `.`, `..` or `.git` part.
 */
export function checkCorrectionPath(path: string): string {
  const parts = path.split('/')
  if (
    path.startsWith('/') ||
    path.includes('\0') ||
    parts.some(
      part =>
        part === '' ||
        part === '.' ||
        part === '..' ||
        part.toLowerCase() === '.git'
    )
  ) {
    throw new PublishError(`${path} is not a path inside the repository`)
  }
  return path
}

/**
 * Commits `files` on `parent` in `clone`, and returns the new commit. The
 * commit is built from git objects in an index of its own: the tree of the
 * analysed commit is never checked out. A link of that tree cannot redirect
 * a write outside the clone, and none of its filters runs.
 */
export async function commitFiles(
  run: CommandRunner,
  clone: string,
  request: {
    parent: string
    files: ReadonlyMap<string, string>
    /** `-c user.name=… -c user.email=…`, or nothing. */
    identity: readonly string[]
    title: string
    body: string
  }
): Promise<string> {
  for (const path of request.files.keys()) checkCorrectionPath(path)
  const work = mkdtempSync(join(tmpdir(), 'compadr-commit-'))
  const env = { GIT_INDEX_FILE: join(work, 'index') }
  const git = async (...args: string[]) =>
    (await run('git', args, clone, env)).trim()
  try {
    await git('read-tree', request.parent)
    const modes = await treeModes(run, clone, request.parent, [
      ...request.files.keys(),
    ])
    // One hash-object and one update-index for all the files.
    const entries = [...request.files]
    const blobFiles = entries.map(([, content], i) => {
      const file = join(work, `blob-${i}`)
      writeFileSync(file, content)
      return file
    })
    const blobs = (
      await git('hash-object', '-w', '--no-filters', '--', ...blobFiles)
    ).split('\n')
    await git(
      'update-index',
      '--add',
      ...entries.flatMap(([path], i) => [
        '--cacheinfo',
        `${fileMode(path, modes)},${blobs[i]},${path}`,
      ])
    )
    const tree = await git('write-tree')
    return await git(
      ...request.identity,
      'commit-tree',
      tree,
      '-p',
      request.parent,
      '-m',
      request.title,
      '-m',
      request.body
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * The mode of each path of `paths` and of each of their folders in the tree
 * of `commit`, for the paths that the tree holds.
 */
async function treeModes(
  run: CommandRunner,
  clone: string,
  commit: string,
  paths: readonly string[]
): Promise<Map<string, string>> {
  const wanted = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      wanted.add(parts.slice(0, i).join('/'))
    }
  }
  const output = await run(
    'git',
    ['--literal-pathspecs', 'ls-tree', '-z', commit, '--', ...wanted],
    clone
  )
  const modes = new Map<string, string>()
  for (const entry of output.split('\0')) {
    // `<mode> <type> <object>\t<path>`
    const tab = entry.indexOf('\t')
    if (tab < 0) continue
    const path = entry.slice(tab + 1)
    if (wanted.has(path)) modes.set(path, entry.slice(0, entry.indexOf(' ')))
  }
  return modes
}

/**
 * The mode of a file of a correction. An executable file stays executable,
 * and a link becomes a regular file. A path under an entry of the tree that
 * is not a folder, such as a folder versioned as a link, is refused.
 */
function fileMode(path: string, modes: ReadonlyMap<string, string>): string {
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) {
    const folder = parts.slice(0, i).join('/')
    const mode = modes.get(folder)
    if (mode !== undefined && mode !== '040000') {
      throw new PublishError(
        `${path} cannot be written: ${folder} is not a folder in the repository`
      )
    }
  }
  const mode = modes.get(path)
  if (mode === '040000' || mode === '160000') {
    throw new PublishError(
      `${path} cannot be written: it is a folder in the repository`
    )
  }
  return mode === '100755' ? '100755' : '100644'
}

/** `git show` of a commit, without the diff programs of any configuration. */
export const SHOW_COMMIT = [
  'show',
  '--stat',
  '--patch',
  '--no-ext-diff',
  '--no-textconv',
  '--format=%s%n',
] as const

export async function publish(
  correction: Correction,
  options: PublishOptions,
  run: CommandRunner = runCommand
): Promise<PublishResult> {
  const clone = mkdtempSync(join(tmpdir(), 'compadr-anchor-'))
  try {
    const git = (...args: string[]) => run('git', args, clone)
    await run('git', [
      'clone',
      '--quiet',
      '--no-checkout',
      '--no-tags',
      correction.repository,
      clone,
    ])
    // The analysed commit may sit on a remote branch of the repository,
    // which a clone does not copy: fetch every ref of the repository.
    await git(
      'fetch',
      '--quiet',
      '--no-tags',
      correction.repository,
      '+refs/*:refs/compadr-source/*'
    )
    const commit = await commitFiles(run, clone, {
      parent: correction.commit,
      files: correction.files,
      identity: await commitIdentity(correction.repository, run),
      title: correction.title,
      body: correction.body,
    })
    const diff = await git(...SHOW_COMMIT, commit)

    if (!options.push && !options.openPullRequest) {
      return { diff, pushedTo: null, pullRequest: null }
    }
    const url = await originUrl(correction.repository, run)
    await git(
      'push',
      '--quiet',
      url,
      `${commit}:refs/heads/${correction.branch}`
    )
    if (!options.openPullRequest) {
      return { diff, pushedTo: url, pullRequest: null }
    }
    const github = options.github ?? githubRepository(url)
    if (github === null) {
      throw new PublishError(
        `${url} is not a GitHub repository: pass --github <owner/name>`
      )
    }
    const pullRequest = (
      await run(
        'gh',
        [
          'pr',
          'create',
          '--repo',
          github,
          '--base',
          options.base,
          '--head',
          correction.branch,
          '--title',
          correction.title,
          '--body',
          correction.body,
        ],
        clone
      )
    ).trim()
    return { diff, pushedTo: url, pullRequest }
  } finally {
    rmSync(clone, { recursive: true, force: true })
  }
}
