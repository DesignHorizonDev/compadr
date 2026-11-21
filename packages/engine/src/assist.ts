// The deterministic half of an assist request: which decisions a model reads
// and how much of the change it sees, chosen from the drift report alone; and
// the guard that checks a suggestion against the request it answers.
import { createHash } from 'node:crypto'
import {
  ASSIST_SCHEMA_VERSION,
  compactDecisionsForFile,
  excludedFromAssist,
  isInForce,
  normalizeRepositoryPath,
  quoteAppearsIn,
  type AcceptRequest,
  type AssistCodeExcerpt,
  type AssistDecision,
  type AssistRecord,
  type AssistRequest,
  type AssistSuggestion,
  type CheckRequest,
  type ConsolidateRequest,
  type DraftRequest,
  type DriftReport,
  type PlainRequest,
} from '@compadr/format'
import { checkChange, parseUnifiedDiff } from './change.ts'
import { renderMemoryCard } from './generated.ts'
import { closeDecisions, proposalOfDraft } from './propose.ts'
import { isCode } from './read-corpus.ts'
import { maskSecrets, maskSecretsInDiff, secretFile } from './secrets.ts'

/** Decisions of a check request, at most. */
export const ASSIST_MAX_DECISIONS = 8
/** Characters of the Decision section of each decision (about 3 400 tokens). */
export const ASSIST_MAX_DECISION_CHARS = 12_000
/** Characters of the diff of a request (about 43 000 tokens). */
export const ASSIST_MAX_DIFF_CHARS = 150_000

export interface AssistBudget {
  maxDecisions?: number
  maxDecisionChars?: number
  maxDiffChars?: number
}

// What a model gains nothing from reading: documentation, translation
// catalogues, lock files and generated code. A GraphQL schema stays, since it
// is often written by hand. Files that hold secrets by their nature (`.env`,
// keys, certificates) never leave either.
const LOCK_FILES = /(?:^|\/)(?:[^/]+\.lock|package-lock\.json|pnpm-lock\.yaml)$/
const GENERATED =
  /(?:^|\/)(?:gql|generated|__generated__)\/|\.generated\.[^/]+$/
const CATALOGUES = /\.po$/

/** Whether a changed file is left out of the diff that a model reads. */
export function leftOutOfAssistDiff(path: string): boolean {
  return (
    !isCode(path) ||
    CATALOGUES.test(path) ||
    LOCK_FILES.test(path) ||
    GENERATED.test(path) ||
    secretFile(path)
  )
}

const FILE_START = /(?=^diff --git )/m
const HEADER_PATH = /^diff --git "?a\/.+?"? "?b\/(.+?)"?$/m
const FIRST_HUNK = /^@@ /m

export interface AssistDiff {
  diff: string
  /** Files that the budget left out. */
  omittedFiles: string[]
}

/**
 * The diff that a model reads: without the files it gains nothing from, with
 * only the header of a deleted file, with its secrets masked, and within the
 * budget. A file that does
 * not fit is left out whole and named in `omittedFiles`.
 */
export function assistDiff(
  diff: string,
  maxChars = ASSIST_MAX_DIFF_CHARS
): AssistDiff {
  const kept: string[] = []
  const omittedFiles: string[] = []
  let size = 0
  for (const part of diff.replace(/\r\n/g, '\n').split(FILE_START)) {
    const match = HEADER_PATH.exec(part)
    if (match === null) continue
    const path = normalizeRepositoryPath(match[1]!)
    if (leftOutOfAssistDiff(path)) continue
    let text = part
    if (/^deleted file mode /m.test(part)) {
      const hunk = FIRST_HUNK.exec(part)
      if (hunk) text = part.slice(0, hunk.index)
    }
    text = maskSecretsInDiff(text)
    if (size + text.length > maxChars) {
      omittedFiles.push(path)
      continue
    }
    kept.push(text)
    size += text.length
  }
  return { diff: kept.join(''), omittedFiles }
}

function repositoryOf(report: DriftReport) {
  const { name, commit, adrDir } = report.repository
  return { name, commit, adrDir }
}

/** The Decision section of a record, as the report keeps it, secrets masked. */
export function decisionText(
  report: DriftReport,
  number: number
): string | null {
  const decision = report.decisions.find(d => d.number === number)
  if (decision?.text === undefined) return null
  return maskSecrets(
    decision.text.sections
      .map(section =>
        section.heading === null
          ? section.markdown
          : `### ${section.heading}\n${section.markdown}`
      )
      .join('\n\n')
  )
}

/**
 * What a model needs to say whether a change breaks a decision. The decisions
 * are those in force that the changed files fall under: first those that a
 * signal of the change names, then the heaviest links to the changed files.
 */
export function buildCheckRequest(
  report: DriftReport,
  diff: string,
  budget: AssistBudget = {}
): CheckRequest {
  const maxDecisions = budget.maxDecisions ?? ASSIST_MAX_DECISIONS
  const maxChars = budget.maxDecisionChars ?? ASSIST_MAX_DECISION_CHARS
  const files = parseUnifiedDiff(diff)
  const change = checkChange(report, files)

  const weights = new Map<number, number>()
  for (const file of files) {
    if (file.status === 'deleted' || leftOutOfAssistDiff(file.path)) continue
    for (const entry of compactDecisionsForFile(report, file.path).inForce) {
      weights.set(
        entry.decision,
        (weights.get(entry.decision) ?? 0) + entry.weight
      )
    }
  }
  const linked = new Map(change.inForce.map(entry => [entry.decision, entry]))
  // `sort` keeps the order of `checkChange` between equal weights.
  const byWeight = [...linked.keys()].sort(
    (a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0)
  )
  const signalled = change.signals
    .map(signal => signal.decision)
    .filter(number => linked.has(number))
  const chosen = [...new Set([...signalled, ...byWeight])].slice(
    0,
    maxDecisions
  )

  const decisions: AssistDecision[] = chosen.map(number => {
    const entry = linked.get(number)!
    const text = decisionText(report, number) ?? ''
    return {
      number,
      title: entry.title,
      status: entry.status,
      ...(entry.rule === undefined ? {} : { rule: maskSecrets(entry.rule) }),
      files: entry.files,
      weight: weights.get(number) ?? 0,
      text: text.slice(0, maxChars),
      truncated: text.length > maxChars,
    }
  })
  return {
    kind: 'check',
    schemaVersion: ASSIST_SCHEMA_VERSION,
    repository: repositoryOf(report),
    memoryCard: maskSecrets(renderMemoryCard(report)),
    decisions,
    signals: change.signals.map(({ type, level, decision, path }) => ({
      type,
      level,
      decision,
      path,
    })),
    ...assistDiff(diff, budget.maxDiffChars),
  }
}

/**
 * The chain that a consolidated rule reads, with the distance of each record
 * to the decision: the decision, the older ones it amends, and the newer ones
 * that amend it, each followed further in the same direction. A sibling
 * (another decision amended by an ancestor) stays out. The newer decisions
 * come from `amends` alone, since a record that says "Amends ADR-0008" does
 * not always fill `amendedBy` of 0008.
 */
function chainDistances(
  report: DriftReport,
  number: number
): Map<number, number> {
  const byNumber = new Map(report.decisions.map(d => [d.number, d]))
  const distances = new Map<number, number>()
  if (!byNumber.has(number)) return distances
  distances.set(number, 0)
  const newer = new Map<number, number[]>()
  for (const decision of report.decisions) {
    for (const older of decision.amends) {
      newer.set(older, [...(newer.get(older) ?? []), decision.number])
    }
  }
  const follow = (next: (n: number) => number[]) => {
    let level = [number]
    const seen = new Set([number])
    for (let distance = 1; level.length > 0; distance++) {
      const following: number[] = []
      for (const n of level) {
        for (const m of next(n)) {
          if (seen.has(m) || !byNumber.has(m)) continue
          seen.add(m)
          following.push(m)
          distances.set(m, Math.min(distances.get(m) ?? distance, distance))
        }
      }
      level = following
    }
  }
  follow(n => byNumber.get(n)?.amends ?? [])
  follow(n => newer.get(n) ?? [])
  return distances
}

/** Every decision of the amendment chain of a decision, by number. */
export function amendmentChain(report: DriftReport, number: number): number[] {
  return [...chainDistances(report, number).keys()].sort((a, b) => a - b)
}

/** Records of a consolidate request, at most. */
export const ASSIST_MAX_RECORDS = 8
/** Characters of the records of a consolidate request (about 34 000 tokens). */
export const ASSIST_MAX_RECORD_CHARS = 120_000

/** Reads a record of the analysed commit, by its path in the repository. */
export type ReadRecord = (file: string) => Promise<string>

async function recordOf(
  report: DriftReport,
  number: number,
  read: ReadRecord
): Promise<AssistRecord> {
  const decision = report.decisions.find(d => d.number === number)
  if (decision === undefined) {
    throw new Error(`Decision ${number} is not in the report.`)
  }
  return {
    number,
    file: decision.file,
    text: maskSecrets(await read(decision.file)),
  }
}

/**
 * The whole records of the amendment chain of a decision, within a budget.
 * The nearest records come first and, at the same distance, those that
 * replace a rule; a record that does not fit is named in `omittedRecords`.
 */
export async function buildConsolidateRequest(
  report: DriftReport,
  number: number,
  read: ReadRecord,
  budget: { maxRecords?: number; maxChars?: number } = {}
): Promise<ConsolidateRequest> {
  const maxRecords = budget.maxRecords ?? ASSIST_MAX_RECORDS
  const maxChars = budget.maxChars ?? ASSIST_MAX_RECORD_CHARS
  const distances = chainDistances(report, number)
  if (distances.size === 0) {
    throw new Error(`Decision ${number} is not in the report.`)
  }
  const replacing = new Set(
    (report.replacedRules ?? []).map(rule => rule.decision)
  )
  const order = [...distances.keys()].sort(
    (a, b) =>
      distances.get(a)! - distances.get(b)! ||
      Number(!replacing.has(a)) - Number(!replacing.has(b)) ||
      a - b
  )
  const records: AssistRecord[] = []
  const omittedRecords: number[] = []
  let size = 0
  for (const n of order) {
    const record = await recordOf(report, n, read)
    const fits =
      n === number ||
      (records.length < maxRecords && size + record.text.length <= maxChars)
    if (fits) {
      records.push(record)
      size += record.text.length
    } else {
      omittedRecords.push(n)
    }
  }
  return {
    kind: 'consolidate',
    schemaVersion: ASSIST_SCHEMA_VERSION,
    repository: repositoryOf(report),
    decision: number,
    records: records.sort((a, b) => a.number - b.number),
    omittedRecords: omittedRecords.sort((a, b) => a - b),
  }
}

/** One whole record, for a version in plain language. */
export async function buildPlainRequest(
  report: DriftReport,
  number: number,
  read: ReadRecord
): Promise<PlainRequest> {
  return {
    kind: 'plain',
    schemaVersion: ASSIST_SCHEMA_VERSION,
    repository: repositoryOf(report),
    record: await recordOf(report, number, read),
  }
}

/** Files of the code in an accept request, at most. */
export const ASSIST_MAX_ACCEPT_FILES = 12
/** Characters of the excerpts of an accept request (about 17 000 tokens). */
export const ASSIST_MAX_EXCERPT_CHARS = 60_000
/** Lines kept before and after each citation of the decision. */
const EXCERPT_BEFORE = 10
const EXCERPT_AFTER = 30

/** The windows of lines around the cited lines of a file, merged when they touch. */
function excerptsOf(path: string, text: string, lines: number[]) {
  const all = text.split('\n')
  const windows: [number, number][] = []
  for (const line of [...lines].sort((a, b) => a - b)) {
    const from = Math.max(1, line - EXCERPT_BEFORE)
    const to = Math.min(all.length, line + EXCERPT_AFTER)
    const last = windows.at(-1)
    if (last !== undefined && from <= last[1] + 1)
      last[1] = Math.max(last[1], to)
    else windows.push([from, to])
  }
  return windows.map(([from, to]) => ({
    path,
    startLine: from,
    text: maskSecrets(all.slice(from - 1, to).join('\n')),
  }))
}

/**
 * A proposed decision and the code that cites it, for a recommendation: the
 * lines around each citation, the files that cite it most first, within a
 * budget. Files that compadr.yml keeps from the service never leave, nor do
 * documentation, lock files and generated code.
 */
export async function buildAcceptRequest(
  report: DriftReport,
  number: number,
  read: ReadRecord,
  budget: { maxFiles?: number; maxChars?: number } = {}
): Promise<AcceptRequest> {
  const maxFiles = budget.maxFiles ?? ASSIST_MAX_ACCEPT_FILES
  const maxChars = budget.maxChars ?? ASSIST_MAX_EXCERPT_CHARS
  const settings = report.assist ?? { semantic: false, exclude: [] }
  const cited = new Map<string, number[]>()
  for (const citation of report.citations) {
    if (citation.decision !== number || !citation.inCode) continue
    const path = normalizeRepositoryPath(citation.file)
    if (leftOutOfAssistDiff(path) || excludedFromAssist(settings, path)) {
      continue
    }
    cited.set(path, [...(cited.get(path) ?? []), citation.line])
  }
  const order = [...cited.keys()].sort(
    (a, b) => cited.get(b)!.length - cited.get(a)!.length || a.localeCompare(b)
  )
  const code: AssistCodeExcerpt[] = []
  const omittedFiles: string[] = []
  let size = 0
  for (const path of order) {
    const excerpts = excerptsOf(path, await read(path), cited.get(path)!)
    const length = excerpts.reduce((sum, e) => sum + e.text.length, 0)
    const files = new Set(code.map(e => e.path)).size
    if (files < maxFiles && size + length <= maxChars) {
      code.push(...excerpts)
      size += length
    } else {
      omittedFiles.push(path)
    }
  }
  return {
    kind: 'accept',
    schemaVersion: ASSIST_SCHEMA_VERSION,
    repository: repositoryOf(report),
    record: await recordOf(report, number, read),
    code,
    omittedFiles: omittedFiles.sort(),
  }
}

/** A change and the decisions in force, for a draft record. */
export function buildDraftRequest(
  report: DriftReport,
  diff: string,
  budget: AssistBudget = {}
): DraftRequest {
  const highest = Math.max(0, ...report.decisions.map(d => d.number))
  return {
    kind: 'draft',
    schemaVersion: ASSIST_SCHEMA_VERSION,
    repository: repositoryOf(report),
    memoryCard: maskSecrets(renderMemoryCard(report)),
    nextNumber: highest + 1,
    ...assistDiff(diff, budget.maxDiffChars),
  }
}

/** SHA-256 of a request, as Compadr sends it: the suggestion carries it back. */
export function assistInputHash(request: AssistRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}

export type AssistProblemCode =
  | 'kind-mismatch'
  | 'input-hash-mismatch'
  | 'unknown-decision'
  | 'decision-not-in-force'
  | 'quote-not-found'
  | 'quote-unverified'
  | 'evidence-outside-change'
  | 'record-outside-chain'
  | 'record-not-accepted'
  | 'code-ref-outside-change'
  | 'evidence-not-sent'
  | 'amendments-missing'
  | 'close-decision'

export interface AssistProblem {
  /** `error` rejects the item; `notice` keeps it, for the reviewer to weigh. */
  level: 'error' | 'notice'
  code: AssistProblemCode
  /** The item of the suggestion, such as `findings[2]`; empty for the whole. */
  item: string
  message: string
}

export interface AssistVerdict {
  /** False when the suggestion as a whole does not answer the request. */
  ok: boolean
  problems: AssistProblem[]
}

/** Paths of the files of a diff, after the change. */
function diffFiles(diff: string): Set<string> {
  return new Set(parseUnifiedDiff(diff).map(file => file.path))
}

/**
 * Checks a suggestion against the request it answers and the report the
 * request was built from. Every number must name a decision of the report,
 * every quote must appear in the text that was sent, and every path of the
 * change must be one of its files. The guard never calls a model.
 */
export function verifySuggestion(
  request: AssistRequest,
  suggestion: AssistSuggestion,
  report: DriftReport
): AssistVerdict {
  const problems: AssistProblem[] = []
  const error = (code: AssistProblemCode, item: string, message: string) =>
    problems.push({ level: 'error', code, item, message })
  const notice = (code: AssistProblemCode, item: string, message: string) =>
    problems.push({ level: 'notice', code, item, message })

  if (suggestion.kind !== request.kind) {
    error(
      'kind-mismatch',
      '',
      `A ${suggestion.kind} suggestion does not answer a ${request.kind} request.`
    )
    return { ok: false, problems }
  }
  if (suggestion.provenance.inputHash !== assistInputHash(request)) {
    error('input-hash-mismatch', '', 'The suggestion answers another request.')
    return { ok: false, problems }
  }
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  const inForce = (item: string, number: number): boolean => {
    const decision = decisions.get(number)
    if (decision === undefined) {
      error('unknown-decision', item, `Decision ${number} does not exist.`)
      return false
    }
    if (!isInForce(decision.status)) {
      error(
        'decision-not-in-force',
        item,
        `Decision ${number} is ${decision.status}.`
      )
      return false
    }
    return true
  }

  if (request.kind === 'check' && suggestion.kind === 'check') {
    const sent = new Map(request.decisions.map(d => [d.number, d]))
    const files = diffFiles(request.diff)
    suggestion.findings.forEach((finding, index) => {
      const item = `findings[${index}]`
      if (!inForce(item, finding.decision)) return
      const decision = sent.get(finding.decision)
      // A decision without text in the report was sent with an empty text.
      if (decision === undefined || decision.text === '') {
        notice(
          'quote-unverified',
          item,
          `The text of decision ${finding.decision} was not sent: its quote cannot be checked.`
        )
      } else if (
        !quoteAppearsIn(
          finding.quote,
          `${decision.text}\n${decision.rule ?? ''}`
        )
      ) {
        error(
          'quote-not-found',
          item,
          `The quote does not appear in decision ${finding.decision}.`
        )
      }
      if (!files.has(normalizeRepositoryPath(finding.evidence.path))) {
        error(
          'evidence-outside-change',
          item,
          `${finding.evidence.path} is not a file of the change.`
        )
      }
    })
  }

  if (request.kind === 'consolidate' && suggestion.kind === 'consolidate') {
    const records = new Map(request.records.map(r => [r.number, r.text]))
    const inChain = (item: string, numbers: number[]): boolean => {
      const outside = numbers.filter(n => !records.has(n))
      if (outside.length > 0) {
        error(
          'record-outside-chain',
          item,
          `Records ${outside.join(', ')} are not in the chain.`
        )
      }
      return outside.length === 0
    }
    suggestion.rules.forEach((rule, index) => {
      const item = `rules[${index}]`
      if (!inChain(item, rule.sources)) return
      const found = rule.sources.some(n =>
        quoteAppearsIn(rule.quote, records.get(n)!)
      )
      if (!found) {
        error(
          'quote-not-found',
          item,
          `The quote does not appear in records ${rule.sources.join(', ')}.`
        )
      }
    })
    // A record can amend a section of its own, such as a dated amendment:
    // then it replaces a rule of its own.
    suggestion.replaced.forEach((point, index) => {
      const item = `replaced[${index}]`
      if (!inChain(item, [point.record, point.replacedBy])) return
      // A proposed record changes no rule until a person accepts it. A
      // superseded or deprecated record did replace the rule in its time.
      const by = decisions.get(point.replacedBy)
      if (
        by !== undefined &&
        by.status !== 'accepted' &&
        isInForce(by.status)
      ) {
        notice(
          'record-not-accepted',
          item,
          `Record ${point.replacedBy} is ${by.status}, not accepted: the rule it replaces stays in force.`
        )
      }
    })
    suggestion.conflicts.forEach((conflict, index) =>
      inChain(`conflicts[${index}]`, conflict.records)
    )
  }

  if (request.kind === 'draft' && suggestion.kind === 'draft') {
    suggestion.amends.forEach((n, index) => inForce(`amends[${index}]`, n))
    suggestion.supersedes.forEach((n, index) =>
      inForce(`supersedes[${index}]`, n)
    )
    const files = diffFiles(request.diff)
    suggestion.codeRefs.forEach((ref, index) => {
      // A model may write the path as code, between backticks.
      const path = normalizeRepositoryPath(
        ref.replace(/`/g, '').trim().split('#')[0]!.split(':')[0]!
      )
      if (!files.has(path)) {
        notice(
          'code-ref-outside-change',
          `codeRefs[${index}]`,
          `${ref} is not a file of the change.`
        )
      }
    })
    // A record that repeats a decision in force is better as an amendment.
    if (suggestion.notNeeded === null) {
      for (const close of closeDecisions(report, proposalOfDraft(suggestion))) {
        notice(
          'close-decision',
          'title',
          `Decision ${close.number} (${close.title}) shares ${close.shared.join(', ')}: amend it, if the change only details it.`
        )
      }
    }
  }

  if (request.kind === 'accept' && suggestion.kind === 'accept') {
    // The lines of the excerpts of each file, trimmed: a line of evidence
    // must be one of them, whole.
    const excerptLines = new Map<string, Set<string>>()
    for (const excerpt of request.code) {
      const set = excerptLines.get(excerpt.path) ?? new Set<string>()
      for (const line of excerpt.text.split('\n')) set.add(line.trim())
      excerptLines.set(excerpt.path, set)
    }
    suggestion.points.forEach((point, index) => {
      const item = `points[${index}]`
      if (!quoteAppearsIn(point.quote, request.record.text)) {
        error(
          'quote-not-found',
          item,
          `The quote does not appear in record ${request.record.number}.`
        )
        return
      }
      if (point.evidence === null) return
      const known = excerptLines.get(
        normalizeRepositoryPath(point.evidence.path)
      )
      const lines = point.evidence.text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '')
      const shown =
        known !== undefined &&
        lines.length > 0 &&
        lines.every(line => known.has(line))
      if (!shown) {
        error(
          'evidence-not-sent',
          item,
          `The evidence is not in the excerpts of ${point.evidence.path} that were sent.`
        )
      }
    })
    if (
      suggestion.recommendation === 'amend-then-accept' &&
      suggestion.amendments.length === 0
    ) {
      notice(
        'amendments-missing',
        'amendments',
        'The suggestion recommends to amend the record, and says not what to change.'
      )
    }
  }

  return { ok: true, problems }
}
