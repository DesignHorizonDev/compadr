// Writes a correction of the decision records on a new branch, away from the
// analysed repository. The engine only reads; this module writes, and only in
// a temporary clone:
//
// - in the analysed repository it runs `git clone` (from it), `git fetch`
//   (from it) and `git config --get` (the author identity and the URL of
//   origin), which change nothing there;
// - in the temporary clone it checks out a new branch, writes the records,
//   commits, and pushes the branch to the remote of the analysed repository;
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
    await git('checkout', '--quiet', '-b', correction.branch, correction.commit)
    for (const [path, content] of correction.files) {
      writeFileSync(join(clone, path), content)
    }
    await git('add', '--', ...correction.files.keys())
    await run(
      'git',
      [
        ...(await commitIdentity(correction.repository, run)),
        'commit',
        '--quiet',
        '-m',
        correction.title,
        '-m',
        correction.body,
      ],
      clone
    )
    const diff = await git('show', '--stat', '--patch', '--format=%s%n', 'HEAD')

    if (!options.push && !options.openPullRequest) {
      return { diff, pushedTo: null, pullRequest: null }
    }
    const url = await originUrl(correction.repository, run)
    await git('push', '--quiet', url, `HEAD:refs/heads/${correction.branch}`)
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
