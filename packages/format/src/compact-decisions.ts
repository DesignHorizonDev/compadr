// A short answer to "which decisions apply to this file?", for a coding
// agent: per decision, its rule, the weight of its links to the file and
// what to read next. The full answer, with every link, stays available.
import {
  decisionsForFile,
  linkedBothWays,
  namesFile,
  type FileDecision,
  type FileDecisions,
} from './file-decisions.ts'
import type { DriftReport, Signal } from './report-schema.ts'

/**
 * What an agent reads before it changes the file:
 * - `rule`: the rule, or the title without one, says enough;
 * - `lines`: the record cites lines or a symbol of the file, to read;
 *   a broken link does not count;
 * - `record`: the record and the file cite each other, or the record cites
 *   the file several times: the record is worth opening.
 */
export const READ_HINTS = ['rule', 'lines', 'record'] as const
export type ReadHint = (typeof READ_HINTS)[number]

/** Longest rule in a compact answer, in characters. */
export const COMPACT_RULE_LENGTH = 100

export interface CompactFileDecision {
  decision: number
  title: string
  /** What the decision requires; absent when the record has no rule. */
  rule?: string
  /** Strength of the links to the file: 0 when only a cited folder links it. */
  weight: number
  read: ReadHint
  /** Present when the decision reaches the file through a cited folder only. */
  scope?: 'folder'
  /** Superseded decisions whose links lead to this one. */
  replaces?: number[]
}

export interface CompactFileDecisions {
  path: string
  inForce: CompactFileDecision[]
  context: { decision: number; title: string; status: string }[]
  outOfForce: { decision: number; title: string; status: string }[]
}

const RANK = { broken: 0, review: 1, order: 2, info: 3 } as const

/** The worst drift signal of each reference, info aside. */
export function worstSignals(report: DriftReport): Map<string, Signal> {
  const worst = new Map<string, Signal>()
  for (const signal of report.signals) {
    if (signal.level === 'info' || !('reference' in signal)) continue
    const current = worst.get(signal.reference)
    if (current === undefined || RANK[signal.level] < RANK[current.level]) {
      worst.set(signal.reference, signal)
    }
  }
  return worst
}

function shorten(text: string, length: number): string {
  if (text.length <= length) return text
  const cut = text.slice(0, length - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > length / 2 ? cut.slice(0, space) : cut}…`
}

/**
 * Weight of the links of one decision to one file. A record that cites the
 * file counts 1, its lines 2, an anchored symbol 3, a symbol that the file
 * alone declares 2; a broken reference counts nothing and one to review counts
 * half. The file that cites the record counts
 * 2, however many times. Both directions together count 2 more. A cited
 * folder counts nothing: it says little about each of its files.
 */
export function linkWeight(
  entry: FileDecision,
  path: string,
  signals: ReadonlyMap<string, Signal>
): number {
  let weight = 0
  let fromRecord = false
  let fromFile = false
  for (const link of entry.links) {
    if (!namesFile(link, path)) continue
    if (link.source === 'file-cites-record') {
      if (!fromFile) weight += 2
      fromFile = true
      continue
    }
    fromRecord = true
    if (link.source === 'record-cites-symbol') {
      weight += 2
      continue
    }
    const strength = link.symbol !== null ? 3 : link.lines !== null ? 2 : 1
    const level = signals.get(link.reference)?.level
    weight += strength * (level === 'broken' ? 0 : level === 'review' ? 0.5 : 1)
  }
  if (fromRecord && fromFile) weight += 2
  return Math.round(weight * 10) / 10
}

// A broken link points the agent to nothing to read: it does not count.
function readHint(
  entry: FileDecision,
  path: string,
  signals: ReadonlyMap<string, Signal>
): ReadHint {
  const own = entry.links.filter(
    link =>
      namesFile(link, path) &&
      (link.source === 'file-cites-record' ||
        link.source === 'record-cites-symbol' ||
        signals.get(link.reference)?.level !== 'broken')
  )
  if (
    own.some(
      link =>
        link.source === 'record-cites-symbol' ||
        (link.source === 'record-cites-path' &&
          (link.lines !== null || link.symbol !== null))
    )
  ) {
    return 'lines'
  }
  const both = linkedBothWays(own, path)
  return both || own.length >= 3 ? 'record' : 'rule'
}

/** The compact form of an answer of `decisionsForFile`. */
export function compactFileDecisions(
  report: DriftReport,
  answer: FileDecisions
): CompactFileDecisions {
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  const signals = worstSignals(report)
  const brief = (entry: FileDecision) => ({
    decision: entry.decision,
    title: entry.title,
    status: entry.status,
  })
  return {
    path: answer.path,
    inForce: answer.inForce.map(entry => {
      const decision = decisions.get(entry.decision)
      const rule = decision?.rule?.text
      return {
        decision: entry.decision,
        title: entry.title,
        ...(rule === undefined
          ? {}
          : { rule: shorten(rule, COMPACT_RULE_LENGTH) }),
        weight: linkWeight(entry, answer.path, signals),
        read: readHint(entry, answer.path, signals),
        ...(entry.scope === 'folder' ? { scope: 'folder' as const } : {}),
        ...(entry.replaces.length > 0 ? { replaces: entry.replaces } : {}),
      }
    }),
    context: answer.context.map(brief),
    outOfForce: answer.outOfForce.map(brief),
  }
}

/** `decisionsForFile`, in its compact form. */
export function compactDecisionsForFile(
  report: DriftReport,
  path: string
): CompactFileDecisions {
  return compactFileDecisions(report, decisionsForFile(report, path))
}
