import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  driftReportJsonSchema,
  DriftReportSchema,
  REPORT_SCHEMA_VERSION,
  type DriftReport,
} from '@compadr/format'
import { createDriftReport, runGit, type LocateWasm } from '@compadr/engine'

export interface ReportOptions {
  /** Path of the repository. */
  repository: string
  /** Git reference to analyse. */
  ref: string
  adrDir?: string
  generatorVersion: string
  locateWasm?: LocateWasm
  /**
   * Folder that keeps the reports on disk, one file per commit, so that a
   * new server answers at once on a commit already analysed. Without it, the
   * reports stay in memory.
   */
  cacheDir?: string
}

/** Reports kept on disk for each repository. */
export const KEPT_REPORTS = 5

// A temporary file older than this belongs to a server that stopped.
const HOUR = 60 * 60 * 1000

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 16)

const SCHEMA_DIGEST = hash(JSON.stringify(driftReportJsonSchema()))

/**
 * The reports of one repository on disk. A file name depends on the commit,
 * the ADR folder, the generator version and the schema version: a new
 * version of Compadr never reads a report of an older one. A file that cannot
 * be read or does not match the schema counts as missing.
 */
class DiskReports {
  readonly #folder: string
  readonly #key: string

  constructor(options: ReportOptions & { cacheDir: string }) {
    let repository = options.repository
    try {
      repository = realpathSync(repository)
    } catch {
      // The commit check reports a missing repository.
    }
    this.#folder = join(options.cacheDir, hash(repository))
    this.#key = hash(
      [
        options.adrDir ?? '',
        options.generatorVersion,
        REPORT_SCHEMA_VERSION,
        // A new optional field leaves the version as it is: the schema
        // itself tells apart a report written before the field.
        SCHEMA_DIGEST,
      ].join('\n')
    )
  }

  #file(commit: string): string {
    return join(this.#folder, `${commit}-${this.#key}.json`)
  }

  read(commit: string): DriftReport | null {
    try {
      const report = DriftReportSchema.parse(
        JSON.parse(readFileSync(this.#file(commit), 'utf8'))
      )
      return report.repository.commit === commit ? report : null
    } catch {
      return null
    }
  }

  /** Writes the report, then keeps the most recent files only. */
  write(report: DriftReport): void {
    try {
      mkdirSync(this.#folder, { recursive: true })
      const file = this.#file(report.repository.commit)
      // A server that stops halfway leaves a temporary file, never a broken
      // report.
      const partial = `${file}.${process.pid}.tmp`
      writeFileSync(partial, JSON.stringify(report))
      renameSync(partial, file)
      const files = readdirSync(this.#folder)
        .filter(name => name.endsWith('.json') || name.endsWith('.tmp'))
        .map(name => join(this.#folder, name))
        .map(path => ({ path, time: statSync(path).mtimeMs }))
        .sort((a, b) => b.time - a.time)
      const reports = files.filter(file => file.path.endsWith('.json'))
      // A temporary file left by a server that stopped halfway goes too.
      const stale = files.filter(
        file => file.path.endsWith('.tmp') && file.time < Date.now() - HOUR
      )
      for (const old of [...reports.slice(KEPT_REPORTS), ...stale]) {
        rmSync(old.path, { force: true })
      }
    } catch {
      // The disk only saves time: a server that cannot write keeps serving.
    }
  }
}

/**
 * The drift report of the reference, computed once per commit. Each call
 * reads the commit of the reference, which takes a few milliseconds, and
 * computes the report again only when the commit changed. With a cache
 * folder, a report already on disk replaces the computation.
 */
export class ReportCache {
  readonly #options: ReportOptions
  readonly #disk: DiskReports | null
  #current: { commit: string; report: Promise<DriftReport> } | null = null

  constructor(options: ReportOptions) {
    this.#options = options
    this.#disk =
      options.cacheDir === undefined
        ? null
        : new DiskReports({ ...options, cacheDir: options.cacheDir })
  }

  async commit(): Promise<string> {
    const { repository, ref } = this.#options
    return (
      await runGit(repository, 'rev-parse', [
        '--verify',
        '--end-of-options',
        `${ref}^{commit}`,
      ])
    ).trim()
  }

  async get(): Promise<DriftReport> {
    const commit = await this.commit()
    if (this.#current?.commit !== commit) {
      const report = this.#compute(commit).then(report => ({
        ...report,
        // The report names the reference the server follows, not its commit.
        repository: { ...report.repository, ref: this.#options.ref },
      }))
      this.#current = { commit, report }
      // A failed computation is not kept: the next call tries again.
      report.catch(() => {
        if (this.#current?.report === report) this.#current = null
      })
    }
    return this.#current.report
  }

  async #compute(commit: string): Promise<DriftReport> {
    const saved = this.#disk?.read(commit)
    if (saved) return saved
    const { repository, adrDir, generatorVersion, locateWasm } = this.#options
    const report = await createDriftReport(repository, {
      ref: commit,
      adrDir,
      generatorVersion,
      locateWasm,
    })
    this.#disk?.write(report)
    return report
  }

  /** Reads a file of the repository at a commit. */
  async read(commit: string, path: string): Promise<string> {
    return runGit(this.#options.repository, 'show', [`${commit}:${path}`])
  }
}
