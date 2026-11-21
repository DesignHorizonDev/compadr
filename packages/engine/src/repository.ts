import { GitCommandFailedError, runGit } from './git.ts'

/** UTC timestamp without milliseconds, as in the drift report. */
export function toTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function parentFolders(file: string): string[] {
  const folders: string[] = []
  let end = file.lastIndexOf('/')
  while (end > 0) {
    folders.push(file.slice(0, end))
    end = file.lastIndexOf('/', end - 1)
  }
  return folders
}

/** The commits of a reference, indexed by the files and folders they changed. */
export class History {
  // Sorted commit dates for each changed file and each of its folders.
  private readonly dates = new Map<string, string[]>()

  constructor(commits: readonly { date: string; files: readonly string[] }[]) {
    for (const { date, files } of commits) {
      const paths = new Set(
        files.flatMap(file => [file, ...parentFolders(file)])
      )
      for (const path of paths) {
        const list = this.dates.get(path)
        if (list) list.push(date)
        else this.dates.set(path, [date])
      }
    }
    for (const list of this.dates.values()) list.sort()
  }

  /** Number of commits that changed a file or a folder strictly after `date`. */
  commitsSince(path: string, date: string): number {
    const list = this.dates.get(path) ?? []
    let low = 0
    let high = list.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (list[middle]! <= date) low = middle + 1
      else high = middle
    }
    return list.length - low
  }
}

/** Commits of a record that the report keeps. */
export const HISTORY_LIMIT = 20

/**
 * Read-only access to a git repository, frozen on one commit. Every read goes
 * through `runGit` and names the commit, never the working tree.
 */
export class Repository {
  readonly path: string
  readonly ref: string
  /** Full SHA of the commit that every read names. */
  readonly commit: string
  /** Tracked files of the commit. */
  readonly files: ReadonlySet<string>
  /** Folders that contain at least one tracked file. */
  readonly folders: ReadonlySet<string>
  /** Last segment of each folder (`src`, `server`, `adr`…). */
  readonly folderNames: ReadonlySet<string>
  private readonly lastChanges = new Map<string, Promise<string | null>>()
  private readonly lineDateCache = new Map<string, Promise<string | null>>()
  private readonly filesByName = new Map<string, string[]>()
  private readonly foldersByName = new Map<string, string[]>()

  private constructor(
    path: string,
    ref: string,
    commit: string,
    files: ReadonlySet<string>
  ) {
    this.path = path
    this.ref = ref
    this.commit = commit
    this.files = files
    const folders = new Set([...files].flatMap(parentFolders))
    this.folders = folders
    this.folderNames = new Set(
      [...folders].map(folder => folder.slice(folder.lastIndexOf('/') + 1))
    )
    for (const [paths, index] of [
      [files, this.filesByName],
      [folders, this.foldersByName],
    ] as const) {
      for (const path of paths) {
        const name = path.slice(path.lastIndexOf('/') + 1)
        const list = index.get(name)
        if (list) list.push(path)
        else index.set(name, [path])
      }
    }
  }

  /** Tracked files whose last segment is `name`. */
  filesNamed(name: string): readonly string[] {
    return this.filesByName.get(name) ?? []
  }

  /** Folders whose last segment is `name`. */
  foldersNamed(name: string): readonly string[] {
    return this.foldersByName.get(name) ?? []
  }

  /** Opens the repository at `path` on the commit named by `ref`. */
  static async open(path: string, ref = 'HEAD'): Promise<Repository> {
    const commit = (
      await runGit(path, 'rev-parse', [
        '--verify',
        '--end-of-options',
        `${ref}^{commit}`,
      ])
    ).trim()
    const listing = await runGit(path, 'ls-tree', [
      '-r',
      '--name-only',
      '-z',
      commit,
    ])
    const files = new Set(listing.split('\0').filter(Boolean))
    return new Repository(path, ref, commit, files)
  }

  /** Content of a tracked file at the commit. */
  read(file: string): Promise<string> {
    return runGit(this.path, 'show', [`${this.commit}:${file}`])
  }

  /** Date of the last commit that changed a file or a folder, or null. */
  lastChange(path: string): Promise<string | null> {
    let change = this.lastChanges.get(path)
    if (change === undefined) {
      change = runGit(this.path, 'log', [
        '-1',
        '--format=%ct',
        this.commit,
        '--',
        path,
      ]).then(output => {
        const seconds = output.trim()
        return seconds === '' ? null : toTimestamp(Number(seconds))
      })
      this.lastChanges.set(path, change)
    }
    return change
  }

  /** The last commits that changed a file, the most recent first. */
  async fileHistory(
    file: string,
    limit = HISTORY_LIMIT
  ): Promise<
    { commit: string; date: string; author: string; subject: string }[]
  > {
    const output = await runGit(this.path, 'log', [
      `-${limit}`,
      '--format=%H%x09%ct%x09%an%x09%s',
      this.commit,
      '--',
      file,
    ])
    return output
      .split('\n')
      .filter(line => line !== '')
      .map(line => {
        const [commit, seconds, author, ...subject] = line.split('\t')
        return {
          commit: commit!,
          date: toTimestamp(Number(seconds)),
          author: author!,
          subject: subject.join('\t'),
        }
      })
  }

  /**
   * Commit that added a file and its author, or null when git finds none. A
   * file added more than once keeps its first commit.
   */
  async addedBy(
    file: string
  ): Promise<{ commit: string; author: string } | null> {
    const output = await runGit(this.path, 'log', [
      '--diff-filter=A',
      '--format=%H%x09%an',
      this.commit,
      '--',
      file,
    ])
    const first = output
      .split('\n')
      .filter(line => line !== '')
      .at(-1)
    if (first === undefined) return null
    const [commit, ...author] = first.split('\t')
    return { commit: commit!, author: author.join('\t') }
  }

  /**
   * Number of lines of a tracked file: `wc -l`, plus a last line without
   * newline.
   */
  async lineCount(file: string): Promise<number> {
    const content = await this.read(file)
    if (content === '') return 0
    const newlines = content.split('\n').length - 1
    return content.endsWith('\n') ? newlines : newlines + 1
  }

  /**
   * Date one line of a file was written, from `git blame` (author date), or
   * null when the file has fewer lines.
   */
  lineDate(file: string, line: number): Promise<string | null> {
    const key = `${line}:${file}`
    let date = this.lineDateCache.get(key)
    if (date === undefined) {
      date = runGit(
        this.path,
        'blame',
        ['--porcelain', '-L', `${line},${line}`, this.commit, '--', file],
        // git blame exits with 128 when the line is beyond the end.
        { okExitCodes: [128] }
      ).then(output => {
        const time = /^author-time (\d+)$/m.exec(output)?.[1]
        return time === undefined ? null : toTimestamp(Number(time))
      })
      this.lineDateCache.set(key, date)
    }
    return date
  }

  /**
   * Commits of the reference since a date (YYYY-MM-DD or later), with the
   * files they changed, read in one pass.
   */
  async history(since: string): Promise<History> {
    // With -z, git writes each path as it is (no quotes, no octal escapes for
    // non-ASCII characters), like `ls-tree -z`. Output:
    // \x01<time>\0\n<path>\0<path>\0\x01<time>…
    const output = await runGit(this.path, 'log', [
      '-z',
      `--since=${since.slice(0, 10)}`,
      '--name-only',
      '--format=%x01%ct',
      this.commit,
    ])
    const commits = output
      .split('\x01')
      .slice(1)
      .map(block => {
        const [time, ...paths] = block.split('\0')
        const files = paths
          .map(path => path.replace(/^\n/, ''))
          .filter(path => path !== '')
        return { date: toTimestamp(Number(time)), files }
      })
    return new History(commits)
  }

  /**
   * Commit that wrote each line of a file, its date (author date) and its
   * author, from `git blame`. Index 0 is line 1.
   */
  async lineOrigins(
    file: string
  ): Promise<{ commit: string; date: string; author: string }[]> {
    const output = await runGit(this.path, 'blame', [
      '--porcelain',
      this.commit,
      '--',
      file,
    ])
    const times = new Map<string, number>()
    const authors = new Map<string, string>()
    const shaOfLine = new Map<number, string>()
    let sha = ''
    for (const line of output.split('\n')) {
      const header = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(line)
      if (header) {
        sha = header[1]!
        shaOfLine.set(Number(header[2]), sha)
      } else if (line.startsWith('author-time ')) {
        times.set(sha, Number(line.slice('author-time '.length)))
      } else if (line.startsWith('author ')) {
        authors.set(sha, line.slice('author '.length))
      }
    }
    return [...shaOfLine.keys()]
      .sort((a, b) => a - b)
      .map(finalLine => {
        const commit = shaOfLine.get(finalLine)!
        return {
          commit,
          date: toTimestamp(times.get(commit)!),
          author: authors.get(commit) ?? '',
        }
      })
  }

  /**
   * Content of a file at another commit, or null when the file does not exist
   * there. Not cached: each call reads git.
   */
  async readAt(commit: string, file: string): Promise<string | null> {
    try {
      return await runGit(this.path, 'show', [`${commit}:${file}`])
    } catch (error) {
      if (error instanceof GitCommandFailedError) return null
      throw error
    }
  }
}
