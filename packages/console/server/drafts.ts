// The local drafts of each repository that the console serves. The actions
// of correction of the pages add their commit to one of them, through the
// draft store of the command line: the analysed repository is never
// written, and nothing leaves the machine. `compadr draft publish`
// publishes a draft. A repository may hold several named drafts; the pages
// fill the default one unless a request names another.
import {
  buildAcceptCorrection,
  buildCheckedCorrection,
  buildCorrection,
  buildRulesCorrection,
  checkDraftName,
  DraftStore,
  runCommand,
  type CommandRunner,
  type CommitAuthor,
  type Draft,
  type FollowedRecommendation,
} from '@compadr/cli/drafts'
import { createDriftReport, runGit, type LocateWasm } from '@compadr/engine'
import type { DriftReport } from '@compadr/format'
import { basename } from 'node:path'
import type {
  AcceptDecisionRequest,
  AnchorRequest,
  CheckRequest,
  DraftState,
  ValidateRulesRequest,
} from '../src/drafts.ts'

export interface DraftRepository {
  /** Identifier of the report of the repository. */
  id: string
  repository: string
  /** The reference that the server follows. */
  ref: string
  adrDir?: string
  /** The commit of the reference, read at each call. */
  commit: () => Promise<string>
}

/**
 * The person who adds a commit, when the server knows who signed in: the
 * author of the commit, and the name recorded with a check.
 */
export interface DraftActor extends CommitAuthor {
  login: string
}

export interface DraftOptions {
  /** Name of the default draft of each repository. */
  name: string
  /** Folder of the drafts, as for `compadr --draft`. */
  cacheDir: string
  generatorVersion: string
  locateWasm?: LocateWasm
  run?: CommandRunner
  /** The date of an acceptance or a validation; now by default. Tests fix it. */
  now?: () => Date
  /**
   * The rules that the assist service consolidated along the chain of a
   * decision of a repository, by the identifier of its report: the output of
   * `compadr assist consolidate`, read by the server and never taken from a
   * request. Undefined when there is none.
   */
  consolidation?: (repositoryId: string, decision: number) => unknown
}

/** A request that the draft cannot take: an unknown reference, for one. */
export class DraftRequestError extends Error {}

export interface ConsoleDrafts {
  /** Whether a report identifier is the report of a draft. */
  isDraftReport(id: string): boolean
  /**
   * A draft of the repository of a report, or undefined for none: the draft
   * that `draft` names, else the draft of a draft report, else the default.
   */
  state(reportId: string, draft?: string): Promise<DraftState | undefined>
  check(
    reportId: string,
    request: CheckRequest,
    actor?: DraftActor
  ): Promise<DraftState>
  anchor(
    reportId: string,
    request: AnchorRequest,
    actor?: DraftActor
  ): Promise<DraftState>
  /** Accepts a proposed decision: its status becomes accepted, today. */
  accept(
    reportId: string,
    request: AcceptDecisionRequest,
    actor?: DraftActor
  ): Promise<DraftState>
  /**
   * Validates the rules in force of a feature, as the assist service
   * consolidated them: they go into features.yml.
   */
  validateRules(
    reportId: string,
    request: ValidateRulesRequest,
    actor?: DraftActor
  ): Promise<DraftState>
  /**
   * The patch of a draft and the commit of its tip, or of one of its
   * commits. Undefined when the draft does not exist.
   */
  patch(
    reportId: string,
    draft: string,
    commit?: string
  ): Promise<{ state: DraftState; tip: string; patch: string } | undefined>
  /**
   * Pushes a draft and opens one pull request, if its tip is still
   * `expectedTip`: a commit added meanwhile was not reviewed.
   */
  publish(
    reportId: string,
    draft: string,
    request: {
      expectedTip: string
      branch: string
      title: string
      body: string
      /** False when a pull request already follows the branch. */
      openPullRequest: boolean
      /**
       * Checks again, in the queue of the repository, that the publication
       * is still allowed. It throws to refuse.
       */
      confirm?: () => Promise<void>
      /** `owner/name` on GitHub, when the origin does not say it. */
      github?: string
      /** Credentials of the push, and the opening of the pull request. */
      pushEnv?: Readonly<Record<string, string>>
      createPullRequest?: Parameters<
        DraftStore['publish']
      >[1]['createPullRequest']
    }
  ): Promise<{ pushedTo: string; pullRequest: string | null }>
  /**
   * Adds a record to a new draft that starts at the tip of a branch: its
   * pull request goes into the branch, where the record is reviewed with the
   * code. A draft of that name that exists already is refused, because the
   * record it holds waits for review.
   */
  propose(
    repositoryId: string,
    request: {
      name: string
      /** The tip of the branch, where the draft starts. */
      commit: string
      /** The branch that the pull request of the draft goes into. */
      branch: string
    },
    correct: (
      report: DriftReport,
      read: (file: string) => Promise<string>
    ) => Promise<Parameters<DraftStore['add']>[1]>,
    actor?: DraftActor
  ): Promise<DraftState>
  /** The report of the tip of a draft, by its report identifier. */
  report(id: string): Promise<DriftReport | undefined>
  /** The reports of the drafts that exist, for the list of reports. */
  reports(): Promise<{ id: string; report: DriftReport }[]>
}

/** The day of a date where the server runs, YYYY-MM-DD: a person accepts on their own day. */
function localDay(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

// A model or a prompt version is a name: no space, no line break.
const PROVENANCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,99}$/

/** The recommendation of a request, checked field by field; none when absent. */
function followedRecommendation(
  value: unknown
): FollowedRecommendation | undefined {
  if (value === undefined || value === null) return undefined
  const r = value as Record<string, unknown>
  if (
    typeof value !== 'object' ||
    r.recommendation !== 'accept' ||
    typeof r.model !== 'string' ||
    typeof r.promptVersion !== 'string' ||
    !PROVENANCE_NAME.test(r.model) ||
    !PROVENANCE_NAME.test(r.promptVersion)
  ) {
    throw new DraftRequestError(
      'recommendation must name an accept recommendation, its model and its prompt version'
    )
  }
  return {
    recommendation: 'accept',
    model: r.model,
    promptVersion: r.promptVersion,
  }
}

function strings(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(item => typeof item === 'string' && item !== '')
  ) {
    throw new DraftRequestError(`${field} must be a list of identifiers`)
  }
  return value as string[]
}

export function consoleDrafts(
  repositories: readonly DraftRepository[],
  options: DraftOptions
): ConsoleDrafts {
  const run = options.run ?? runCommand
  const PREFIX = '--draft.'
  const reportIdOf = (repository: DraftRepository, name: string) =>
    `${repository.id}${PREFIX}${name}`
  const stores = new Map<string, Promise<DraftStore>>()
  const store = (repository: DraftRepository) => {
    let found = stores.get(repository.id)
    if (found === undefined) {
      found = DraftStore.open(repository.repository, options.cacheDir, run)
      stores.set(repository.id, found)
      found.catch(() => stores.delete(repository.id))
    }
    return found
  }
  // One write at a time in each clone, whatever the draft.
  const queues = new Map<string, Promise<unknown>>()
  function queued<T>(repository: DraftRepository, work: () => Promise<T>) {
    const previous = queues.get(repository.id) ?? Promise.resolve()
    const next = previous.then(work, work)
    queues.set(
      repository.id,
      next.catch(() => {})
    )
    return next
  }
  // The report of each tip, by commit.
  const tips = new Map<string, Promise<DriftReport>>()

  /** A valid draft name, or null. */
  function validName(name: string): string | null {
    try {
      return checkDraftName(name)
    } catch {
      return null
    }
  }

  /**
   * The repository of a report, and the draft that the report names: a
   * draft report names its draft, the report of the repository none.
   */
  function owner(
    reportId: string
  ): { repository: DraftRepository; name: string | null } | undefined {
    for (const repository of repositories) {
      if (reportId === repository.id) return { repository, name: null }
      const prefix = `${repository.id}${PREFIX}`
      if (reportId.startsWith(prefix)) {
        const name = validName(reportId.slice(prefix.length))
        if (name !== null) return { repository, name }
      }
    }
    return undefined
  }

  async function tipReport(
    repository: DraftRepository,
    draft: Draft
  ): Promise<DriftReport> {
    const drafts = await store(repository)
    const tip = (
      await runGit(drafts.clone, 'rev-parse', [`${draft.branch}^{commit}`])
    ).trim()
    let report = tips.get(tip)
    if (report === undefined) {
      report = createDriftReport(drafts.clone, {
        ref: tip,
        adrDir: repository.adrDir,
        name: basename(repository.repository),
        generatorVersion: options.generatorVersion,
        locateWasm: options.locateWasm,
      }).then(computed => ({
        ...computed,
        repository: { ...computed.repository, ref: draft.branch },
      }))
      tips.set(tip, report)
      report.catch(() => tips.delete(tip))
    }
    return report
  }

  async function state(
    repository: DraftRepository,
    name: string
  ): Promise<DraftState> {
    const drafts = await store(repository)
    const all = await drafts.list()
    const summaries = []
    for (const other of all) {
      const commits = await drafts.commits(other)
      summaries.push({
        name: other.name,
        reportId: reportIdOf(repository, other.name),
        commits: commits.length,
        authors: [...new Set(commits.map(c => c.author))],
      })
    }
    const draft = all.find(d => d.name === name) ?? null
    return {
      name,
      repository: repository.repository,
      baseReportId: repository.id,
      reportId: draft === null ? null : reportIdOf(repository, name),
      base: draft?.base ?? null,
      baseBranch: draft?.baseBranch ?? null,
      commits:
        draft === null
          ? []
          : (await drafts.commits(draft)).map(
              ({ commit, subject, author }) => ({ commit, subject, author })
            ),
      drafts: summaries,
    }
  }

  /** The draft, created at the commit that the server follows. */
  async function open(
    repository: DraftRepository,
    name: string
  ): Promise<{ draft: Draft; created: boolean }> {
    const drafts = await store(repository)
    return drafts.open(name, async () => {
      const commit = await repository.commit()
      const branch = (
        await runGit(repository.repository, 'rev-parse', [
          '--abbrev-ref',
          repository.ref,
        ]).catch(() => 'HEAD')
      ).trim()
      return {
        commit,
        baseBranch:
          branch === 'HEAD' || branch === ''
            ? null
            : branch.replace(/^origin\//, ''),
      }
    })
  }

  /** The draft that a request names, else the one of its report, else the default. */
  function draftName(fromReport: string | null, requested: unknown): string {
    if (requested !== undefined && requested !== null && requested !== '') {
      if (typeof requested !== 'string') {
        throw new DraftRequestError('draft must be the name of a draft')
      }
      return checkDraftName(requested)
    }
    return fromReport ?? options.name
  }

  async function add(
    reportId: string,
    requested: unknown,
    author: CommitAuthor | undefined,
    correct: (
      repository: DraftRepository,
      draft: Draft,
      report: DriftReport,
      read: (file: string) => Promise<string>
    ) => Promise<Parameters<DraftStore['add']>[1]>
  ): Promise<DraftState> {
    const found = owner(reportId)
    if (found === undefined) {
      throw new DraftRequestError(`no repository for the report ${reportId}`)
    }
    const { repository } = found
    const name = draftName(found.name, requested)
    return queued(repository, async () => {
      const drafts = await store(repository)
      const { draft, created } = await open(repository, name)
      try {
        const report = await tipReport(repository, draft)
        const tip = report.repository.commit
        const correction = await correct(repository, draft, report, file =>
          runGit(drafts.clone, 'show', [`${tip}:${file}`])
        )
        await drafts.add(draft, correction, author)
      } catch (error) {
        // A refused first correction leaves no empty draft behind.
        if (created) await drafts.discard(draft).catch(() => {})
        throw error
      }
      return state(repository, name)
    })
  }

  const authorOf = (actor: DraftActor | undefined): CommitAuthor | undefined =>
    actor === undefined ? undefined : { name: actor.name, email: actor.email }

  return {
    isDraftReport: id => owner(id)?.name != null,

    async state(reportId, draft) {
      const found = owner(reportId)
      return found === undefined
        ? undefined
        : state(found.repository, draftName(found.name, draft))
    },

    check: (reportId, request, actor) => {
      const references = strings(request.references, 'references')
      const by = typeof request.by === 'string' ? request.by.trim() : ''
      return add(
        reportId,
        request.draft,
        authorOf(actor),
        async (repository, draft, report, read) => {
          const drafts = await store(repository)
          // The commits of a draft change records only: the code checked is
          // the code of its start.
          const seconds = (
            await runGit(drafts.clone, 'log', [
              '-1',
              '--format=%ct',
              draft.base,
            ])
          ).trim()
          const user = (
            await run('git', [
              '-C',
              repository.repository,
              'config',
              '--get',
              'user.name',
            ]).catch(() => '')
          ).trim()
          return buildCheckedCorrection(
            repository.repository,
            report,
            {
              references,
              at: `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19)}Z`,
              // A person signed in checks under their own name, whatever
              // the request says.
              by: actor?.login ?? (by || user || undefined),
            },
            read
          )
        }
      )
    },

    anchor: (reportId, request, actor) => {
      const references = strings(request.references, 'references')
      return add(
        reportId,
        request.draft,
        authorOf(actor),
        (repository, _draft, report, read) =>
          buildCorrection(
            repository.repository,
            report,
            { references, withLines: request.withLines === true },
            read
          )
      )
    },

    accept: (reportId, request, actor) => {
      if (
        typeof request.decision !== 'number' ||
        !Number.isInteger(request.decision)
      ) {
        throw new DraftRequestError('decision must be the number of a decision')
      }
      const followed = followedRecommendation(request.recommendation)
      return add(
        reportId,
        request.draft,
        authorOf(actor),
        (repository, _draft, report, read) =>
          buildAcceptCorrection(
            repository.repository,
            report,
            {
              decision: request.decision,
              date: localDay(options.now?.() ?? new Date()),
              ...(followed === undefined ? {} : { recommendation: followed }),
            },
            read
          )
      )
    },

    validateRules: (reportId, request, actor) => {
      const feature = request.feature
      if (typeof feature !== 'string' || feature === '') {
        throw new DraftRequestError(
          'feature must be the identifier of a feature'
        )
      }
      return add(
        reportId,
        request.draft,
        authorOf(actor),
        async (repository, _draft, report, read) => {
          // Only a declared feature with a main decision has rules to read:
          // otherwise the command says why, before any file is read.
          const found = report.features?.find(f => f.id === feature)
          const main =
            found?.source === 'declared' && found.main !== null
              ? found.main
              : null
          let suggestion: unknown
          if (main !== null) {
            try {
              suggestion = await options.consolidation?.(repository.id, main)
            } catch (error) {
              // A file of the folder that a person can fix.
              throw new DraftRequestError((error as Error).message)
            }
            if (suggestion === undefined) {
              throw new DraftRequestError(
                `no consolidation of ADR ${String(main).padStart(4, '0')} for this repository: run compadr assist consolidate --decision ${main} --out <findings-dir>/${repository.id}.consolidate-${main}.json`
              )
            }
          }
          // An unknown feature, or one without a main decision: the command
          // says why.
          return buildRulesCorrection(
            repository.repository,
            report,
            feature,
            suggestion,
            {},
            read,
            file => read(file).catch(() => null),
            localDay(options.now?.() ?? new Date())
          )
        }
      )
    },

    propose(repositoryId, request, correct, actor) {
      const repository = repositories.find(r => r.id === repositoryId)
      if (repository === undefined) {
        throw new DraftRequestError(
          `no repository for the report ${repositoryId}`
        )
      }
      const name = checkDraftName(request.name)
      return queued(repository, async () => {
        const drafts = await store(repository)
        const { draft, created } = await drafts.open(name, () =>
          Promise.resolve({
            commit: request.commit,
            baseBranch: request.branch,
          })
        )
        if (!created) {
          throw new DraftRequestError(
            `the draft ${name} exists already: review it on the Draft page, then publish or discard it`
          )
        }
        try {
          const report = await tipReport(repository, draft)
          const tip = report.repository.commit
          const correction = await correct(report, file =>
            runGit(drafts.clone, 'show', [`${tip}:${file}`])
          )
          await drafts.add(draft, correction, authorOf(actor))
        } catch (error) {
          // A refused record leaves no empty draft behind.
          await drafts.discard(draft).catch(() => {})
          throw error
        }
        return state(repository, name)
      })
    },

    async patch(reportId, name, commit) {
      const found = owner(reportId)
      if (found === undefined) return undefined
      const checked = checkDraftName(name)
      const drafts = await store(found.repository)
      const draft = await drafts.get(checked)
      if (draft === null) return undefined
      return {
        state: await state(found.repository, checked),
        tip: await drafts.tip(draft),
        patch: await drafts.diff(draft, commit),
      }
    },

    async publish(reportId, name, request) {
      const found = owner(reportId)
      if (found === undefined) {
        throw new DraftRequestError(`no repository for the report ${reportId}`)
      }
      const { repository } = found
      const checked = checkDraftName(name)
      return queued(repository, async () => {
        const drafts = await store(repository)
        const draft = await drafts.get(checked)
        if (draft === null) {
          throw new DraftRequestError(`no draft ${checked}`)
        }
        if ((await drafts.tip(draft)) !== request.expectedTip) {
          throw new DraftRequestError(
            `draft ${checked} changed since its review: review it again`
          )
        }
        await request.confirm?.()
        return drafts.publish(draft, {
          branch: request.branch,
          openPullRequest: request.openPullRequest,
          ...(request.github ? { github: request.github } : {}),
          ...(request.pushEnv ? { pushEnv: request.pushEnv } : {}),
          ...(request.createPullRequest
            ? { createPullRequest: request.createPullRequest }
            : {}),
          base: draft.baseBranch,
          title: request.title,
          body: request.body,
        })
      })
    },

    async report(id) {
      const found = owner(id)
      if (found?.name == null) return undefined
      const draft = await (await store(found.repository)).get(found.name)
      return draft === null ? undefined : tipReport(found.repository, draft)
    },

    async reports() {
      const found: { id: string; report: DriftReport }[] = []
      for (const repository of repositories) {
        for (const draft of await (await store(repository)).list()) {
          found.push({
            id: reportIdOf(repository, draft.name),
            report: await tipReport(repository, draft),
          })
        }
      }
      return found
    },
  }
}
