// Local drafts: corrections of the decision records that add up on one branch
// before a single pull request. A draft is a branch `drafts/<name>` of a clone
// that Compadr owns, under its cache folder, one clone per analysed
// repository. The analysed repository is never written:
//
// - in the analysed repository Compadr runs `git clone` and `git fetch` (from
//   it), `git rev-parse` and `git config --get`, which change nothing there;
// - in its own clone it creates the draft branches, writes the records and
//   commits, and pushes a draft to the origin remote of the analysed
//   repository on `compadr draft publish`;
// - `gh pr create` opens the pull request on GitHub.
//
// Each correction command passes `--draft <name>`: it reads the records at the
// tip of the draft, so that a second correction sees the first one.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  commitIdentity,
  githubRepository,
  originUrl,
  PublishError,
  runCommand,
  type CommandRunner,
  type Correction,
} from './publish.ts'

export class DraftError extends Error {}

/** Prefix of the draft branches in the clone. */
const PREFIX = 'drafts/'
/** Git configuration section of the clone that describes each draft. */
const SECTION = 'compadr-draft'

/** A draft name: letters, digits, dots, hyphens and underscores. */
export function checkDraftName(name: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ||
    name.includes('..') ||
    name.endsWith('.lock') ||
    name.endsWith('.')
  ) {
    throw new DraftError(
      `${name} is not a draft name: use letters, digits, ".", "-" and "_"`
    )
  }
  return name
}

/** Folder of the clone of a repository, under the cache folder. */
export function draftClonePath(cacheDir: string, root: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12)
  const name = basename(root).replace(/[^A-Za-z0-9._-]/g, '-') || 'repository'
  return join(cacheDir, 'drafts', `${name}-${hash}`)
}

export interface Draft {
  name: string
  /** Branch of the draft in the clone. */
  branch: string
  /** Commit of the analysed repository the draft starts from. */
  base: string
  /** Branch that the pull request targets, when Compadr found one. */
  baseBranch: string | null
}

export interface DraftCommit {
  commit: string
  subject: string
  /** Name of the author of the commit. */
  author: string
}

/** Who writes a commit, when it is not the git user of the repository. */
export interface CommitAuthor {
  name: string
  email: string
}

/** The drafts of one analysed repository, in the clone that Compadr owns. */
export class DraftStore {
  readonly clone: string
  readonly #repository: string
  readonly #run: CommandRunner

  private constructor(repository: string, clone: string, run: CommandRunner) {
    this.#repository = repository
    this.clone = clone
    this.#run = run
  }

  /**
   * The store of `repository`, under `cacheDir`. The clone is made on the
   * first draft only: `exists` is false until then.
   */
  static async open(
    repository: string,
    cacheDir: string,
    run: CommandRunner = runCommand
  ): Promise<DraftStore> {
    const root = (
      await run('git', ['-C', repository, 'rev-parse', '--show-toplevel'])
    ).trim()
    return new DraftStore(
      root,
      draftClonePath(cacheDir, realpathSync(root)),
      run
    )
  }

  get exists(): boolean {
    return existsSync(join(this.clone, '.git'))
  }

  #git(...args: string[]): Promise<string> {
    return this.#run('git', args, this.clone)
  }

  /** Makes the clone if needed, and copies every ref of the repository. */
  async #sync(): Promise<void> {
    if (!this.exists) {
      mkdirSync(dirname(this.clone), { recursive: true })
      await this.#run('git', [
        'clone',
        '--quiet',
        '--no-checkout',
        '--no-tags',
        this.#repository,
        this.clone,
      ])
    }
    // The commit of a draft may sit on any ref of the repository, a remote
    // branch included, which a clone does not copy.
    await this.#git(
      'fetch',
      '--quiet',
      '--no-tags',
      this.#repository,
      '+refs/*:refs/compadr-source/*'
    )
  }

  async #config(name: string, key: string): Promise<string | null> {
    const value = (
      await this.#git('config', '--get', `${SECTION}.${name}.${key}`).catch(
        () => ''
      )
    ).trim()
    return value === '' ? null : value
  }

  async #has(commit: string): Promise<boolean> {
    return this.#git('cat-file', '-e', `${commit}^{commit}`).then(
      () => true,
      () => false
    )
  }

  /** The draft, or null when it does not exist. */
  async get(name: string): Promise<Draft | null> {
    checkDraftName(name)
    if (!this.exists) return null
    const base = await this.#config(name, 'base')
    const tip = (
      await this.#git(
        'for-each-ref',
        '--format=%(objectname)',
        `refs/heads/${PREFIX}${name}`
      )
    ).trim()
    if (base === null || tip === '') return null
    return {
      name,
      branch: `${PREFIX}${name}`,
      base,
      baseBranch: await this.#config(name, 'baseBranch'),
    }
  }

  /**
   * The draft, created at `commit` of the analysed repository when it does
   * not exist. `baseBranch` is the branch the pull request will target.
   */
  async open(
    name: string,
    start: () => Promise<{ commit: string; baseBranch: string | null }>
  ): Promise<{ draft: Draft; created: boolean }> {
    await this.#sync()
    const found = await this.get(name)
    if (found !== null) return { draft: found, created: false }
    const { commit, baseBranch } = await start()
    // A detached HEAD or a commit that no ref carries is not in the copied
    // refs: fetch the commit itself.
    if (!(await this.#has(commit))) {
      await this.#git('fetch', '--quiet', '--no-tags', this.#repository, commit)
      if (!(await this.#has(commit))) {
        throw new DraftError(`commit ${commit} cannot be copied to the draft`)
      }
    }
    await this.#git('branch', '--force', `${PREFIX}${name}`, commit)
    await this.#git('config', `${SECTION}.${name}.base`, commit)
    if (baseBranch !== null) {
      await this.#git('config', `${SECTION}.${name}.baseBranch`, baseBranch)
    }
    return {
      draft: { name, branch: `${PREFIX}${name}`, base: commit, baseBranch },
      created: true,
    }
  }

  /**
   * Commits a correction on the draft and returns the diff of the commit.
   * The author is the git user of the analysed repository, unless `author`
   * names someone else, such as the person signed in to a portal.
   */
  async add(
    draft: Draft,
    correction: Correction,
    author?: CommitAuthor
  ): Promise<string> {
    await this.#git('checkout', '--quiet', '--force', draft.branch)
    for (const [path, content] of correction.files) {
      const file = join(this.clone, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
    }
    await this.#git('add', '--', ...correction.files.keys())
    await this.#run(
      'git',
      [
        ...(author === undefined
          ? await commitIdentity(this.#repository, this.#run)
          : [
              '-c',
              `user.name=${author.name}`,
              '-c',
              `user.email=${author.email}`,
            ]),
        'commit',
        '--quiet',
        '-m',
        correction.title,
        '-m',
        correction.body,
      ],
      this.clone
    )
    return this.#git('show', '--stat', '--patch', '--format=%s%n', 'HEAD')
  }

  /** The names of the drafts, in name order. */
  async list(): Promise<Draft[]> {
    if (!this.exists) return []
    const names = (
      await this.#git(
        'for-each-ref',
        '--format=%(refname:strip=3)',
        `refs/heads/${PREFIX}`
      )
    )
      .split('\n')
      .filter(line => line !== '')
      .sort()
    const drafts: Draft[] = []
    for (const name of names) {
      const draft = await this.get(name).catch(() => null)
      if (draft !== null) drafts.push(draft)
    }
    return drafts
  }

  /** The commits of the draft, the oldest first. */
  async commits(draft: Draft): Promise<DraftCommit[]> {
    return (
      await this.#git(
        'log',
        '--reverse',
        '--format=%H%x09%an%x09%s',
        `${draft.base}..${draft.branch}`
      )
    )
      .split('\n')
      .filter(line => line !== '')
      .map(line => {
        const [commit, author, ...subject] = line.split('\t')
        return {
          commit: commit!,
          author: author ?? '',
          subject: subject.join('\t'),
        }
      })
  }

  /** The commit at the tip of the draft. */
  async tip(draft: Draft): Promise<string> {
    return (await this.#git('rev-parse', `${draft.branch}^{commit}`)).trim()
  }

  /**
   * The patch of the whole draft, from its start to its tip, or of one of
   * its commits. A commit outside the draft is refused.
   */
  async diff(draft: Draft, commit?: string): Promise<string> {
    if (commit === undefined) {
      return this.#git(
        // A path with letters outside ASCII stays as it is in the patch.
        '-c',
        'core.quotePath=false',
        'diff',
        '--no-color',
        '--no-ext-diff',
        draft.base,
        draft.branch
      )
    }
    if (!/^[0-9a-f]{7,64}$/.test(commit)) {
      throw new DraftError(`${commit} is not a commit of draft ${draft.name}`)
    }
    const inDraft = (await this.commits(draft)).some(c =>
      c.commit.startsWith(commit)
    )
    if (!inDraft) {
      throw new DraftError(`${commit} is not a commit of draft ${draft.name}`)
    }
    return this.#git(
      '-c',
      'core.quotePath=false',
      'show',
      '--no-color',
      '--no-ext-diff',
      '--format=',
      commit
    )
  }

  /** `git diff --stat` between the start and the tip of the draft. */
  diffStat(draft: Draft): Promise<string> {
    return this.#git('diff', '--stat', draft.base, draft.branch)
  }

  /** The message of a commit of the draft, without its subject. */
  async body(commit: string): Promise<string> {
    return (await this.#git('log', '-1', '--format=%b', commit)).trim()
  }

  /** Deletes the draft branch and its description. */
  async discard(draft: Draft): Promise<void> {
    // The checked out branch cannot be deleted: leave it first.
    await this.#git('checkout', '--quiet', '--force', '--detach')
    await this.#git('branch', '--quiet', '-D', draft.branch)
    await this.#git(
      'config',
      '--remove-section',
      `${SECTION}.${draft.name}`
    ).catch(() => '')
  }

  /**
   * Pushes the draft to the origin remote of the analysed repository, on
   * `branch`, and opens a pull request when asked. The push is never forced:
   * a draft that grew since its last publication adds its new commits.
   */
  async publish(
    draft: Draft,
    options: {
      branch: string
      openPullRequest: boolean
      base: string | null
      title: string
      body: string
      github?: string
      /**
       * Variables that give git its credentials for the push only, such as
       * the token of a GitHub App. They never reach a file.
       */
      pushEnv?: Readonly<Record<string, string>>
      /** Opens the pull request in place of `gh pr create`. */
      createPullRequest?: (request: {
        github: string
        base: string
        head: string
        title: string
        body: string
      }) => Promise<string>
    }
  ): Promise<{ pushedTo: string; pullRequest: string | null }> {
    const url = await originUrl(this.#repository, this.#run)
    // The pull request needs its base and its GitHub repository: both are
    // checked before anything leaves the machine.
    let github: string | null = null
    if (options.openPullRequest) {
      if (options.base === null) {
        throw new DraftError(
          `draft ${draft.name} has no base branch: pass --base <branch>`
        )
      }
      github = options.github ?? githubRepository(url)
      if (github === null) {
        throw new PublishError(
          `${url} is not a GitHub repository: pass --github <owner/name>`
        )
      }
    }
    await this.#run(
      'git',
      ['push', '--quiet', url, `${draft.branch}:refs/heads/${options.branch}`],
      this.clone,
      options.pushEnv
    )
    if (github === null) return { pushedTo: url, pullRequest: null }
    if (options.createPullRequest) {
      const pullRequest = await options.createPullRequest({
        github,
        base: options.base!,
        head: options.branch,
        title: options.title,
        body: options.body,
      })
      return { pushedTo: url, pullRequest }
    }
    const pullRequest = (
      await this.#run(
        'gh',
        [
          'pr',
          'create',
          '--repo',
          github,
          '--base',
          options.base!,
          '--head',
          options.branch,
          '--title',
          options.title,
          '--body',
          options.body,
        ],
        this.clone
      )
    ).trim()
    return { pushedTo: url, pullRequest }
  }
}
