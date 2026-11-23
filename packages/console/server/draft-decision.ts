// The record that the assist service drafts from the change of a branch, as
// the console asks for it. A person asks for it with a button: the change of
// the branch leaves the machine, and each draft costs. The server writes the
// record, with the status proposed, into a new local draft that starts at the
// tip of the branch: its pull request goes into the branch, where a person
// reviews the record with the code. The server keeps the outcome for the
// commit of the branch, so that a second click does not pay again. The files
// that `assist.exclude` of compadr.yml names never leave the machine.
//
// With an outcome client, the server tells the service what became of each
// draft, by the hash of its request and without its text: `shown` when the
// service answers. A server that publishes the drafts itself (`publications`)
// also sends `followed` when a person publishes the draft, and `dismissed`
// when the draft disappears without a publication. A console whose drafts
// are published by the command line sends `shown` only: it cannot tell a
// draft published and then discarded from a draft set aside.
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  AssistServiceError,
  httpAssistClient,
  runAssist,
  withoutExcluded,
  type AssistClient,
  type SuggestionOutcome,
  type AssistOutcomeClient,
} from '@compadr/assist'
import { buildProposeCorrection, checkDraftName } from '@compadr/cli/drafts'
import {
  buildDraftRequest,
  changeBetween,
  parseUnifiedDiff,
  type ProposedRecord,
} from '@compadr/engine'
import { ASSIST_SCHEMA_VERSION } from '@compadr/format'
import type { DraftDecisionOutcome } from '../src/assist.ts'
import type { ConsoleDrafts, DraftActor } from './drafts.ts'
import type { BranchSource } from './repository-reports.ts'

/** A change that cannot be drafted, such as a branch without change. */
export class DraftDecisionRequestError extends Error {}

/** A change whose files `assist.exclude` keeps in the repository. */
export class DraftDecisionExcludedError extends DraftDecisionRequestError {}

/**
 * A branch whose draft holds a record already, for an earlier commit: the
 * service is not asked until a person publishes or discards that draft.
 */
export class DraftDecisionExistsError extends DraftDecisionRequestError {}

/** The service failed, or the guard rejected its answer. */
export class DraftDecisionServiceError extends Error {}

export interface DraftDecisionOptions {
  /** Address of the service, from COMPADR_ASSIST_URL. */
  url: string
  /** Token of the service, from COMPADR_ASSIST_TOKEN. */
  token: string
  /** The local drafts, where the record goes. */
  drafts: ConsoleDrafts
  /** Folder of the outcomes already kept; memory only without it. */
  cacheDir?: string
  /** Builds the client; the tests give a fake one. */
  client?: (url: string, token: string) => AssistClient
  /** The date of the record; now by default. Tests fix it. */
  now?: () => Date
  /** Sends the outcomes of the drafts to the service; none without it. */
  outcomes?: {
    client: AssistOutcomeClient
    /**
     * Whether this server publishes the drafts itself, through
     * `published`: it then sends `followed` and `dismissed` too.
     */
    publications: boolean
    /** Receives a failure to send an outcome; the draft goes on. */
    warn?: (message: string) => void
  }
}

export interface ConsoleDraftDecision {
  /** The outcome kept for the branch at its commit, or undefined. */
  cached(source: BranchSource): Promise<DraftDecisionOutcome | undefined>
  /** The outcome kept, or a new draft from the service. */
  draft(source: BranchSource, actor?: DraftActor): Promise<DraftDecisionOutcome>
  /**
   * A person published a draft: when the service drafted its record, the
   * outcome `followed` goes to the service. `draftReportId` is the report of
   * the draft (`DraftState.reportId`).
   */
  published(draftReportId: string): Promise<void>
}

/** The name of the draft of a branch: `propose-` and the branch name. */
export function draftNameOf(branch: string): string {
  const part = branch
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/(?:\.lock)+$/, '')
    .replace(/\.+$/, '')
  const name = `propose-${part}`
  try {
    return checkDraftName(name)
  } catch {
    return 'propose'
  }
}

/** The day of a date where the server runs, YYYY-MM-DD. */
function localDay(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/**
 * The key of an outcome: the service, the repository and the change. A new
 * commit on the branch, or on the reference it leaves, asks again.
 */
function keyOf(service: string, source: BranchSource): string {
  const { name, adrDir } = source.report.repository
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: ASSIST_SCHEMA_VERSION,
        service,
        repository: { name, adrDir },
        from: source.from,
        commit: source.commit,
      })
    )
    .digest('hex')
}

function isOutcome(value: unknown): value is DraftDecisionOutcome {
  const outcome = value as Partial<DraftDecisionOutcome> | null
  const result = outcome?.result as { kind?: unknown } | undefined
  return (
    typeof outcome === 'object' &&
    outcome !== null &&
    typeof outcome.commit === 'string' &&
    Array.isArray(outcome.problems) &&
    Array.isArray(outcome.excluded) &&
    (result?.kind === 'drafted' || result?.kind === 'not-needed')
  )
}

export function consoleDraftDecision(
  options: DraftDecisionOptions
): ConsoleDraftDecision {
  const client = (
    options.client ?? ((url, token) => httpAssistClient({ url, token }))
  )(options.url, options.token)
  const service = options.url.replace(/\/+$/, '')
  const folder =
    options.cacheDir === undefined
      ? undefined
      : join(options.cacheDir, 'draft-decision')
  const kept = new Map<string, DraftDecisionOutcome>()
  const outcomes = options.outcomes

  /** Sends an outcome without waiting: a failure never stops the draft. */
  function tell(
    found: DraftDecisionOutcome,
    outcome: SuggestionOutcome['outcome']
  ): Promise<void> {
    if (outcomes === undefined || found.inputHash === undefined) {
      return Promise.resolve()
    }
    return outcomes.client
      .report({ inputHash: found.inputHash, kind: 'draft', outcome })
      .catch((error: unknown) =>
        outcomes.warn?.(
          `the outcome ${outcome} of a draft did not reach the assist service: ${(error as Error).message}`
        )
      )
  }
  // A second click while the first waits does not pay twice.
  const pending = new Map<string, Promise<DraftDecisionOutcome>>()

  function fromDisk(key: string): DraftDecisionOutcome | undefined {
    if (folder === undefined) return undefined
    try {
      const value: unknown = JSON.parse(
        readFileSync(join(folder, `${key}.json`), 'utf8')
      )
      return isOutcome(value) ? value : undefined
    } catch {
      return undefined
    }
  }

  function keep(key: string, outcome: DraftDecisionOutcome) {
    kept.set(key, outcome)
    if (folder === undefined) return
    try {
      mkdirSync(folder, { recursive: true })
      const file = join(folder, `${key}.json`)
      writeFileSync(`${file}.tmp`, JSON.stringify(outcome))
      renameSync(`${file}.tmp`, file)
    } catch {
      // The outcome stays in memory.
    }
  }

  /** Every outcome kept, in memory and on disk. */
  function allKept(): [string, DraftDecisionOutcome][] {
    const all = new Map(kept)
    if (folder !== undefined) {
      let names: string[] = []
      try {
        names = readdirSync(folder)
      } catch {
        // No folder yet: nothing kept on disk.
      }
      for (const name of names) {
        const key = name.replace(/\.json$/, '')
        if (key === name || all.has(key)) continue
        const found = fromDisk(key)
        if (found !== undefined) all.set(key, found)
      }
    }
    return [...all]
  }

  function forget(key: string) {
    kept.delete(key)
    if (folder === undefined) return
    try {
      writeFileSync(join(folder, `${key}.json`), '{}')
    } catch {
      // A file that cannot be written cannot be read back either.
    }
  }

  /**
   * The outcome kept for a change. A record drafted into a draft that a
   * person discarded since is forgotten: the button shows again.
   */
  async function known(
    key: string,
    source: BranchSource
  ): Promise<DraftDecisionOutcome | undefined> {
    const found = kept.get(key) ?? fromDisk(key)
    if (found === undefined) return undefined
    if (found.result.kind === 'drafted') {
      const state = await options.drafts.state(
        source.repositoryId,
        found.result.draft
      )
      if (state?.reportId == null) {
        forget(key)
        // Gone without a publication through this server: set aside.
        // The page does not wait for the service.
        if (outcomes?.publications && found.followed !== true) {
          void tell(found, 'dismissed')
        }
        return undefined
      }
    }
    kept.set(key, found)
    return found
  }

  /** The change of the branch that may leave the machine. */
  async function changeOf(
    source: BranchSource
  ): Promise<{ diff: string; excluded: string[] }> {
    const { report } = source
    // Without the settings, nothing says what may leave: nothing leaves.
    if (report.assist === undefined) {
      throw new DraftDecisionRequestError(
        'the report does not give the assist settings of compadr.yml: compute it again'
      )
    }
    const diff = await changeBetween(
      source.repository,
      source.from,
      source.commit
    )
    if (parseUnifiedDiff(diff).length === 0) {
      throw new DraftDecisionRequestError(
        `${source.branch} holds the same files as the reference`
      )
    }
    const change = withoutExcluded(diff, report)
    if (parseUnifiedDiff(change.diff).length === 0) {
      throw new DraftDecisionExcludedError(
        'every file of the change stays in the repository: assist.exclude of compadr.yml names them'
      )
    }
    return change
  }

  /** Refuses a branch whose draft exists already, before anything costs. */
  async function checkNoDraft(source: BranchSource): Promise<void> {
    const name = draftNameOf(source.branch)
    const state = await options.drafts.state(source.repositoryId, name)
    if (state?.reportId != null) {
      throw new DraftDecisionExistsError(
        `the draft ${name} holds a record for this branch already: review it on the Draft page, then publish or discard it`
      )
    }
  }

  async function ask(
    source: BranchSource,
    actor: DraftActor | undefined
  ): Promise<DraftDecisionOutcome> {
    const { report } = source
    const change = await changeOf(source)
    await checkNoDraft(source)
    const request = buildDraftRequest(report, change.diff)
    let outcome
    try {
      outcome = await runAssist(client, request, report)
    } catch (error) {
      throw new DraftDecisionServiceError(
        error instanceof AssistServiceError
          ? error.message
          : `the assist service failed: ${(error as Error).message}`
      )
    }
    const suggestion = outcome.suggestion
    if (suggestion === null || suggestion.kind !== 'draft') {
      throw new DraftDecisionServiceError(
        `the guard rejected the answer of the service: ${outcome.problems[0]?.message ?? 'no draft'}`
      )
    }
    const common = {
      model: suggestion.provenance.model,
      promptVersion: suggestion.provenance.promptVersion,
      inputHash: suggestion.provenance.inputHash,
      createdAt: suggestion.provenance.createdAt,
      commit: source.commit,
      excluded: change.excluded,
      problems: outcome.problems.map(({ level, code, item, message }) => ({
        level,
        code,
        item,
        message,
      })),
    }
    if (suggestion.notNeeded !== null) {
      return {
        ...common,
        result: { kind: 'not-needed', reason: suggestion.notNeeded },
      }
    }
    const name = draftNameOf(source.branch)
    let record: ProposedRecord | undefined
    const state = await options.drafts.propose(
      source.repositoryId,
      { name, commit: source.commit, branch: source.branch },
      async (tip, read) => {
        // The record follows the latest record of the branch.
        const latest = [...tip.decisions].sort((a, b) => b.number - a.number)[0]
        const template =
          latest === undefined
            ? null
            : await read(latest.file).catch(() => null)
        const built = buildProposeCorrection(
          source.repository,
          // The reader knows the draft by its name, not by its branch.
          { ...tip, repository: { ...tip.repository, ref: `draft ${name}` } },
          suggestion,
          { base: source.from, head: source.commit },
          template,
          localDay(options.now?.() ?? new Date())
        )
        record = built.record
        return built.correction
      },
      actor
    )
    return {
      ...common,
      result: {
        kind: 'drafted',
        draft: name,
        reportId: state.reportId,
        number: record!.number,
        path: record!.path,
        title: suggestion.title,
        notes: record!.notes,
      },
    }
  }

  return {
    async cached(source) {
      const found = await known(keyOf(service, source), source)
      if (found !== undefined) return found
      try {
        // A change that never leaves shows no button.
        await changeOf(source)
      } catch (error) {
        // Nothing is kept for a branch without change: the request says why.
        if (error instanceof DraftDecisionExcludedError) throw error
        if (error instanceof DraftDecisionRequestError) return undefined
        throw error
      }
      // A draft that waits for review shows instead of the button.
      await checkNoDraft(source)
      return undefined
    },

    async draft(source, actor) {
      const key = keyOf(service, source)
      const found = await known(key, source)
      if (found !== undefined) return found
      let waiting = pending.get(key)
      if (waiting === undefined) {
        waiting = ask(source, actor).then(outcome => {
          keep(key, outcome)
          // The person sees the draft now; the answer does not wait.
          void tell(outcome, 'shown')
          return outcome
        })
        pending.set(key, waiting)
        waiting.then(
          () => pending.delete(key),
          () => pending.delete(key)
        )
      }
      return waiting
    },

    async published(draftReportId) {
      if (!outcomes?.publications) return
      for (const [key, found] of allKept()) {
        if (
          found.result.kind !== 'drafted' ||
          found.result.reportId !== draftReportId ||
          found.followed === true
        ) {
          continue
        }
        const followed = { ...found, followed: true }
        keep(key, followed)
        await tell(followed, 'followed')
      }
    },
  }
}
