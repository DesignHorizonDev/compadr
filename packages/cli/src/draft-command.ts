// `compadr draft`: lists, shows, publishes and discards the local drafts of a
// repository. The correction commands fill a draft with `--draft <name>`.
import { createDriftReport, type LocateWasm } from '@compadr/engine'
import type { DriftReport, Signal } from '@compadr/format'
import { DraftError, type Draft, type DraftStore } from './draft.ts'

export const DRAFT_SUBCOMMANDS = ['list', 'show', 'publish', 'discard'] as const
export type DraftSubcommand = (typeof DRAFT_SUBCOMMANDS)[number]

export interface DraftOutput {
  out: (line: string) => void
  err: (line: string) => void
}

const short = (commit: string) => commit.slice(0, 8)

function describeBase(draft: Draft): string {
  return draft.baseBranch === null
    ? `from ${short(draft.base)}`
    : `from ${short(draft.base)} (${draft.baseBranch})`
}

async function required(store: DraftStore, name: string): Promise<Draft> {
  const draft = await store.get(name)
  if (draft === null) throw new DraftError(`no draft ${name}`)
  return draft
}

/** What a signal points at, as one line. */
function signalLine(signal: Signal): string {
  const target =
    'reference' in signal && typeof signal.reference === 'string'
      ? signal.reference
      : `ADR-${String(signal.decision).padStart(4, '0')}`
  return `${signal.type} ${target}`
}

/** The signals of `before` that `after` no longer has, and the new ones. */
export function signalChanges(
  before: DriftReport,
  after: DriftReport
): { resolved: Signal[]; added: Signal[] } {
  const was = new Set(before.signals.map(s => s.id))
  const is = new Set(after.signals.map(s => s.id))
  return {
    resolved: before.signals.filter(s => !is.has(s.id)),
    added: after.signals.filter(s => !was.has(s.id)),
  }
}

export async function listDrafts(
  store: DraftStore,
  output: DraftOutput
): Promise<number> {
  const drafts = await store.list()
  if (drafts.length === 0) {
    output.err('No draft. Add one with --draft <name> on a correction command.')
    return 0
  }
  for (const draft of drafts) {
    const count = (await store.commits(draft)).length
    output.out(
      `${draft.name}  ${count} ${count === 1 ? 'commit' : 'commits'}  ${describeBase(draft)}`
    )
  }
  return 0
}

export async function showDraft(
  store: DraftStore,
  name: string,
  report: {
    adrDir?: string
    generatorVersion: string
    locateWasm?: LocateWasm
  },
  output: DraftOutput
): Promise<number> {
  const draft = await required(store, name)
  const commits = await store.commits(draft)
  output.out(`Draft ${draft.name}, ${describeBase(draft)}`)
  output.out('')
  if (commits.length === 0) {
    output.out('No commit yet.')
    return 0
  }
  for (const { commit, subject } of commits) {
    output.out(`${short(commit)} ${subject}`)
  }
  output.out('')
  output.out((await store.diffStat(draft)).trimEnd())
  // The drift report of the start and of the tip, both read in the clone.
  const options = { ...report }
  const [before, after] = await Promise.all([
    createDriftReport(store.clone, { ...options, ref: draft.base }),
    createDriftReport(store.clone, { ...options, ref: draft.branch }),
  ])
  const { resolved, added } = signalChanges(before, after)
  output.out('')
  output.out(
    `Signals: ${before.signals.length} at the start, ${after.signals.length} in the draft`
  )
  for (const signal of resolved) output.out(`- ${signalLine(signal)}`)
  for (const signal of added) output.out(`+ ${signalLine(signal)}`)
  return 0
}

export async function publishDraft(
  store: DraftStore,
  name: string,
  request: {
    branch?: string
    title?: string
    body?: string
    openPullRequest: boolean
    base?: string
    github?: string
  },
  output: DraftOutput
): Promise<number> {
  const draft = await required(store, name)
  const commits = await store.commits(draft)
  if (commits.length === 0) {
    throw new DraftError(`draft ${name} has no commit to publish`)
  }
  const branch = request.branch ?? `compadr/${name}`
  const single = commits.length === 1 ? commits[0]! : null
  const title =
    request.title ??
    single?.subject ??
    `docs(adr): ${commits.length} corrections of the decision records`
  const body =
    request.body ??
    (single !== null
      ? await store.body(single.commit)
      : [
          `This pull request gathers the corrections of the Compadr draft ${name}:`,
          '',
          ...commits.map(c => `- ${c.subject}`),
        ].join('\n'))
  const result = await store.publish(draft, {
    branch,
    openPullRequest: request.openPullRequest,
    base: request.base ?? draft.baseBranch,
    title,
    body,
    github: request.github,
  })
  if (result.pullRequest !== null) {
    output.err(`✔ pull request ${result.pullRequest}`)
  } else {
    output.err(`✔ branch ${branch} pushed to ${result.pushedTo}`)
  }
  output.err(
    `The draft stays: discard it with compadr draft discard once the pull request is merged.`
  )
  return 0
}

export async function discardDraft(
  store: DraftStore,
  name: string,
  output: DraftOutput
): Promise<number> {
  const draft = await required(store, name)
  const count = (await store.commits(draft)).length
  await store.discard(draft)
  output.err(
    `✔ draft ${name} discarded (${count} ${count === 1 ? 'commit' : 'commits'})`
  )
  return 0
}
