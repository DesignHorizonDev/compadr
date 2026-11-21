// Serves the drift reports of git repositories on the routes of
// src/reports.ts. Each repository gives one report, computed at its
// reference by the report cache of the MCP server: the report is computed
// again only when the commit of the reference changes, and a report already
// on disk replaces the computation. The branches that propose decisions get
// a report of their own, computed when the console asks for it.
import { runGit } from '@compadr/engine'
import type { DriftReport } from '@compadr/format'
import { ReportCache, type ReportOptions } from '@compadr/mcp'
import type { ReportFolder } from '../dev/reports-api.ts'
import { summarize, type ReportList } from '../src/reports.ts'
import type { BranchChange, ReviewList, ReviewSummary } from '../src/reviews.ts'
import { attributeToPullRequests, type CommitLookup } from './attribution.ts'
import {
  consoleDrafts,
  type ConsoleDrafts,
  type DraftOptions,
} from './drafts.ts'
import type { ConsoleReports } from './http.ts'
import type { RecordSource } from './plain.ts'
import type { OpenPullRequest } from './pull-requests.ts'
import { findReviews } from './reviews.ts'

function lastFolder(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

/**
 * Identifiers of the repositories: the folder name, then `-2`, `-3` when
 * two repositories share it. An identifier keeps to the characters of the
 * report routes.
 */
export function repositoryIds(repositories: readonly string[]): string[] {
  const taken = new Set<string>()
  return repositories.map(repository => {
    const name =
      lastFolder(repository).replace(/[^A-Za-z0-9._-]/g, '-') || 'repository'
    const base = /^[A-Za-z0-9]/.test(name) ? name : `r${name}`
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    taken.add(id)
    return id
  })
}

/** A branch under review, as the drafting of a decision reads it. */
export interface BranchSource {
  /** Identifier of the report of the repository. */
  repositoryId: string
  repository: string
  adrDir?: string
  /** Name of the branch, as a pull request names it. */
  branch: string
  commit: string
  /** The commit where the branch leaves the reference. */
  from: string
  /** The report of the branch, at `commit`. */
  report: DriftReport
}

export interface RepositoryReports extends ReportFolder {
  /**
   * Starts every computation, with the lookup of the pull requests, so that
   * the first page does not wait.
   */
  warm(): void
  /**
   * The branches that propose decisions, and those that change the code
   * without proposing one, in every repository.
   */
  reviews(): Promise<Required<ReviewList> & { problems: string[] }>
  /**
   * A branch of a branch report, compared with the reference, when it is
   * still ahead of it. Undefined for another report.
   */
  branchSource(id: string): Promise<BranchSource | undefined>
  /** The local drafts of the repositories, unless the server has none. */
  drafts: ConsoleDrafts | null
  /**
   * A report of a repository or of one of its branches, and how to read its
   * records at its commit. Undefined for a draft or an unknown report.
   */
  recordSource(id: string): Promise<RecordSource | undefined>
  /** Set by the server when it can ask the assist service. */
  plain?: ConsoleReports['plain']
  /** Set by the server when it can ask the assist service and keeps drafts. */
  draftDecision?: ConsoleReports['draftDecision']
}

/** A part of a report identifier, from a branch name. */
const idPart = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '-')

export function repositoryReports(
  options: readonly ReportOptions[],
  sources: {
    /** The open pull requests of a repository, to name those of branches. */
    pullRequests?: (repository: string) => Promise<OpenPullRequest[]>
    /** The pull request of a commit, to name who approved or merged it. */
    commitPullRequest?: CommitLookup
    /** The local draft that the actions of correction fill. */
    drafts?: Omit<DraftOptions, 'generatorVersion' | 'locateWasm'>
    /**
     * The identifiers of the repositories, in the order of `options`, when
     * the caller keeps its own. They default to `repositoryIds`.
     */
    ids?: readonly string[]
  } = {}
): RepositoryReports {
  // The attributed copy of each report, made once per computed report. A
  // copy made while gh failed is made again on the next request.
  const attributed = new WeakMap<DriftReport, Promise<DriftReport>>()
  async function served(repository: string, cache: ReportCache) {
    const report = await cache.get()
    const lookup = sources.commitPullRequest
    if (lookup === undefined) return report
    let copy = attributed.get(report)
    if (copy === undefined) {
      const made = attributeToPullRequests(repository, report, lookup)
      copy = made.then(m => m.report)
      attributed.set(report, copy)
      const kept = copy
      void made.then(({ complete }) => {
        if (!complete && attributed.get(report) === kept) {
          attributed.delete(report)
        }
      })
    }
    return copy
  }
  if (sources.ids !== undefined && sources.ids.length !== options.length) {
    throw new Error('one identifier is needed for each repository')
  }
  const ids = [
    ...(sources.ids ?? repositoryIds(options.map(o => o.repository))),
  ]
  const repositories = options.map((o, i) => ({
    id: ids[i]!,
    options: o,
    cache: new ReportCache(o),
  }))
  const drafts =
    sources.drafts === undefined
      ? null
      : consoleDrafts(
          repositories.map(({ id, options: o, cache }) => ({
            id,
            repository: o.repository,
            ref: o.ref,
            adrDir: o.adrDir,
            commit: () => cache.commit(),
          })),
          {
            ...sources.drafts,
            generatorVersion: options[0]?.generatorVersion ?? '0.0.0',
            locateWasm: options[0]?.locateWasm,
          }
        )
  // The report of each branch under review, by report identifier. An
  // identifier stays the same for a branch while the server runs.
  const branchReports = new Map<string, ReportCache>()
  const branchIds = new Map<string, string>()
  // The repository of each branch report, by report identifier.
  const branchRepositories = new Map<string, string>()
  // The branch of each branch report, as the last list of reviews found it.
  const branchFound = new Map<
    string,
    {
      repository: (typeof repositories)[number]
      name: string
      commit: string
      from: string
    }
  >()

  function branchReportId(
    repository: (typeof repositories)[number],
    ref: string,
    name: string
  ): string {
    const key = `${repository.id}\0${ref}`
    let id = branchIds.get(key)
    if (id === undefined) {
      const base = `${repository.id}--${idPart(name)}`
      id = base
      for (
        let n = 2;
        branchReports.has(id) ||
        ids.includes(id) ||
        drafts?.isDraftReport(id) === true;
        n++
      ) {
        id = `${base}-${n}`
      }
      branchIds.set(key, id)
      branchReports.set(id, new ReportCache({ ...repository.options, ref }))
      branchRepositories.set(id, repository.options.repository)
    }
    return id
  }

  // Identifiers asked for and not found since the last list of reviews: a
  // page that asks for them again does not read every branch again.
  const unknown = new Set<string>()

  async function reviews(
    only?: (typeof repositories)[number]
  ): Promise<Required<ReviewList> & { problems: string[] }> {
    unknown.clear()
    const found: ReviewSummary[] = []
    const changes: BranchChange[] = []
    const problems: string[] = []
    for (const repository of only === undefined ? repositories : [only]) {
      try {
        const { options: o } = repository
        const base = await repository.cache.commit()
        const [branches, pullRequests] = await Promise.all([
          findReviews(o.repository, o.adrDir ?? 'docs/adr', base),
          // A lookup of one report needs the branches, not their pull request.
          only === undefined
            ? (sources.pullRequests?.(o.repository) ?? Promise.resolve([]))
            : Promise.resolve([]),
        ])
        // The branches of the repository are replaced at once, after the
        // last wait: a request meanwhile reads the previous list. A branch
        // merged or removed since is no longer under review.
        for (const [id, known] of branchFound) {
          if (known.repository === repository) branchFound.delete(id)
        }
        for (const { branch, from, proposed } of branches) {
          const pr = pullRequests.find(p => p.branch === branch.name)
          const reportId = branchReportId(repository, branch.ref, branch.name)
          branchFound.set(reportId, {
            repository,
            name: branch.name,
            commit: branch.commit,
            from,
          })
          const summary = {
            reportId,
            baseReportId: repository.id,
            branch: branch.name,
            commit: branch.commit,
            pullRequest:
              pr === undefined
                ? null
                : {
                    number: pr.number,
                    title: pr.title,
                    url: pr.url,
                    draft: pr.draft,
                  },
          }
          if (proposed.length > 0) found.push({ ...summary, proposed })
          else changes.push(summary)
        }
      } catch (error) {
        problems.push(`${repository.id}: ${(error as Error).message}`)
      }
    }
    return { reviews: found, changes, problems }
  }

  return {
    warm() {
      // The pull requests are looked up too, before the first page asks.
      for (const { options: o, cache } of repositories) {
        served(o.repository, cache).catch(() => {})
      }
    },
    async list() {
      const reports: ReportList['reports'] = []
      const problems: string[] = []
      for (const { id, cache } of repositories) {
        try {
          reports.push(summarize(id, await cache.get()))
        } catch (error) {
          problems.push(`${id}: ${(error as Error).message}`)
        }
      }
      // The draft of a repository follows it, under the same name.
      try {
        for (const { id, report } of (await drafts?.reports()) ?? []) {
          reports.push(summarize(id, report))
        }
      } catch (error) {
        problems.push(`drafts: ${(error as Error).message}`)
      }
      return { reports, problems }
    },
    drafts,
    reviews: () => reviews(),
    async branchSource(id) {
      // The report first: it looks the branch up when no list did yet.
      const report = await this.get(id)
      const found = branchFound.get(id)
      if (report === undefined || found === undefined) return undefined
      // The report follows the branch: a commit pushed since the list moves
      // the change too.
      const commit = report.repository.commit
      if (commit !== found.commit) {
        await reviews(found.repository)
      }
      const now = branchFound.get(id)
      if (now === undefined || now.commit !== commit) return undefined
      return {
        repositoryId: now.repository.id,
        repository: now.repository.options.repository,
        adrDir: now.repository.options.adrDir,
        branch: now.name,
        commit,
        from: now.from,
        report,
      }
    },
    async recordSource(id) {
      if (drafts?.isDraftReport(id)) return undefined
      // The report first: it finds the branch of a branch report.
      const report = await this.get(id)
      const path =
        repositories.find(r => r.id === id)?.options.repository ??
        branchRepositories.get(id)
      if (path === undefined || report === undefined) return undefined
      const commit = report.repository.commit
      return {
        report,
        read: file => runGit(path, 'show', [`${commit}:${file}`]),
      }
    },
    async get(id) {
      if (drafts?.isDraftReport(id)) return drafts.report(id)
      const repository = repositories.find(r => r.id === id)
      if (repository !== undefined) {
        return served(repository.options.repository, repository.cache)
      }
      // A page opened on a branch report before the list of reviews: only
      // the identifier of a branch of a known repository is looked for, once.
      const owner = repositories.find(r => id.startsWith(`${r.id}--`))
      if (!branchReports.has(id) && owner !== undefined && !unknown.has(id)) {
        await reviews(owner)
        if (!branchReports.has(id)) unknown.add(id)
      }
      const branch = branchReports.get(id)
      return branch === undefined
        ? undefined
        : served(branchRepositories.get(id)!, branch)
    },
  }
}
