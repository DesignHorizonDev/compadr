// The semantic check of a change: what `compadr check --semantic` and the
// `semantic` option of `check_change_against_decisions` ask the assist
// service. Nothing leaves the repository unless its compadr.yml turns the
// check on, and the paths it excludes never leave. The findings are notices:
// they never fail a check.
import {
  buildCheckRequest,
  parseUnifiedDiff,
  type AssistProblem,
} from '@compadr/engine'
import {
  excludedFromAssist,
  SEMANTIC_FINDINGS_SCHEMA_VERSION,
  SemanticFindingsSchema,
  type DriftReport,
  type SemanticFinding,
  type SemanticFindings,
} from '@compadr/format'
import { runAssist } from './assist.ts'
import {
  AssistCapReachedError,
  httpAssistClient,
  type AssistClient,
} from './client.ts'

export interface SemanticOptions {
  /** Address of the service; from COMPADR_ASSIST_URL for the commands. */
  url?: string
  /** Token of the service; from COMPADR_ASSIST_TOKEN for the commands. */
  token?: string
  /** Builds the client; the tests give a fake one. */
  client?: (url: string, token: string) => AssistClient
}

export type { SemanticFinding } from '@compadr/format'

export type SemanticCheck =
  /**
   * Nothing was sent, and why. `capped` when the customer has used the AI
   * credits of its month.
   */
  | { status: 'skipped'; reason: string; capped?: true }
  /** The request was sent and did not get a usable answer. */
  | { status: 'failed'; reason: string }
  | {
      status: 'done'
      findings: SemanticFinding[]
      /** Findings that the guard removed. */
      rejected: number
      /** Changed files that compadr.yml kept from the service. */
      excluded: string[]
      model: string
      promptVersion: string
    }

const FILE_START = /(?=^diff --git )/m

/**
 * The diff without the files that the settings keep in the repository. A
 * part of the diff is the text from one `diff --git` line to the next; a diff
 * written without those lines (`diff -u`, or edited by hand) can hold several
 * files in one part. A part that holds an excluded file stays out whole.
 */
export function withoutExcluded(
  diff: string,
  report: Pick<DriftReport, 'assist'>
): { diff: string; excluded: string[] } {
  const settings = report.assist ?? { semantic: false, exclude: [] }
  if (settings.exclude.length === 0) return { diff, excluded: [] }
  const kept: string[] = []
  const excluded: string[] = []
  for (const part of diff.replace(/\r\n/g, '\n').split(FILE_START)) {
    const files = parseUnifiedDiff(part)
    const paths = files.flatMap(file => [
      file.path,
      ...(file.from === null ? [] : [file.from]),
    ])
    if (paths.some(path => excludedFromAssist(settings, path))) {
      excluded.push(...files.map(file => file.path))
    } else if (files.length === 0 && FILE_START.test(part)) {
      // A file whose paths cannot be read cannot be compared with the
      // settings: it stays in the repository.
      excluded.push(part.split('\n', 1)[0]!.trim())
    } else {
      kept.push(part)
    }
  }
  return { diff: kept.join(''), excluded }
}

/**
 * The line of the new file where the diff adds the evidence: its first added
 * line, or its first line when it quotes no sign of the diff.
 */
function evidenceLine(
  diff: string,
  path: string,
  evidence: string
): number | null {
  const lines = evidence.split('\n')
  const added = lines.filter(line => line.startsWith('+'))
  const first = (added.length > 0 ? added : lines)
    .map(line => line.replace(/^[+ ]/, '').trim())
    .find(line => line !== '')
  if (first === undefined) return null
  const file = parseUnifiedDiff(diff).find(f => f.path === path)
  return file?.added.find(line => line.text.trim() === first)?.line ?? null
}

const ITEM = /^findings\[(\d+)\]$/

/**
 * Why nothing may be sent for a repository, or null when the repository and
 * the settings allow the request: compadr.yml turns the option on, and the
 * service has an address and a token.
 */
export function notSent(
  report: DriftReport,
  options: SemanticOptions,
  /** What the request is for, as the reason names it. */
  what = 'the semantic check'
): string | null {
  if (report.assist?.semantic !== true) {
    return `${what} is off for this repository: set assist.semantic to true in ${report.repository.adrDir}/compadr.yml`
  }
  if (options.url === undefined || options.url === '') {
    return 'no assist service is configured (COMPADR_ASSIST_URL)'
  }
  if (options.token === undefined || options.token === '') {
    return 'the token of the assist service is missing (COMPADR_ASSIST_TOKEN)'
  }
  return null
}

/**
 * Asks the assist service whether a change breaks a decision in force. The
 * answer goes through the guard before anyone reads it.
 */
export async function semanticCheck(
  report: DriftReport,
  diff: string,
  options: SemanticOptions
): Promise<SemanticCheck> {
  const reason = notSent(report, options)
  if (reason !== null) return { status: 'skipped', reason }
  const kept = withoutExcluded(diff, report)
  const request = buildCheckRequest(report, kept.diff)
  if (request.diff.trim() === '') {
    return {
      status: 'skipped',
      reason:
        kept.excluded.length > 0
          ? 'the change holds no code that compadr.yml lets the service read'
          : 'the change holds no code for the service to read',
    }
  }
  let outcome
  try {
    const client = (
      options.client ?? ((url, token) => httpAssistClient({ url, token }))
    )(options.url!, options.token!)
    outcome = await runAssist(client, request, report)
  } catch (error) {
    if (error instanceof AssistCapReachedError) {
      return { status: 'skipped', reason: error.message, capped: true }
    }
    return { status: 'failed', reason: (error as Error).message }
  }
  const suggestion = outcome.suggestion
  if (suggestion === null || suggestion.kind !== 'check') {
    return {
      status: 'failed',
      reason: `the guard rejected the answer of the service: ${outcome.problems[0]?.message ?? ''}`,
    }
  }
  // The guard names the items by their index in the answer, before it
  // removed the rejected ones: count the notices by the index they keep.
  const rejected = new Set<number>()
  const noticesAt = new Map<number, AssistProblem[]>()
  for (const problem of outcome.problems) {
    const match = ITEM.exec(problem.item)
    if (match === null) continue
    const index = Number(match[1])
    if (problem.level === 'error') rejected.add(index)
    else noticesAt.set(index, [...(noticesAt.get(index) ?? []), problem])
  }
  const keptIndexes = [
    ...Array(suggestion.findings.length + rejected.size).keys(),
  ].filter(index => !rejected.has(index))
  const titles = new Map(report.decisions.map(d => [d.number, d.title]))
  return {
    status: 'done',
    findings: suggestion.findings.map((finding, position) => ({
      ...finding,
      title: titles.get(finding.decision) ?? '',
      // The evidence quotes the diff as it was sent, with its secrets masked.
      line: evidenceLine(
        request.diff,
        finding.evidence.path,
        finding.evidence.text
      ),
      notices: (noticesAt.get(keptIndexes[position]!) ?? []).map(
        problem => problem.message
      ),
    })),
    rejected: outcome.rejected,
    excluded: kept.excluded,
    model: suggestion.provenance.model,
    promptVersion: suggestion.provenance.promptVersion,
  }
}

/**
 * The findings file of a semantic check that ran, for the console; null when
 * nothing was sent or the service failed.
 */
export function semanticFindings(
  check: SemanticCheck,
  report: DriftReport,
  base: string | null,
  now: Date = new Date()
): SemanticFindings | null {
  if (check.status !== 'done') return null
  const { name, commit, adrDir } = report.repository
  return SemanticFindingsSchema.parse({
    schemaVersion: SEMANTIC_FINDINGS_SCHEMA_VERSION,
    repository: { name, commit, adrDir },
    base,
    generatedAt: now.toISOString(),
    model: check.model,
    promptVersion: check.promptVersion,
    findings: check.findings,
    rejected: check.rejected,
    excluded: check.excluded,
  })
}
