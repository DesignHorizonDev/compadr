// The decisions that a proposed decision may overlap, found in the report of
// its branch. Every reason is deterministic: a relation that the proposal
// declares, a file that both records cite, a term between backticks that
// both decisions use, and the feature they share.
import {
  isInForce,
  type Decision,
  type DriftReport,
  type Feature,
} from '@compadr/format'

export type OverlapReason =
  | { kind: 'relation'; text: string }
  | { kind: 'files'; files: string[] }
  | { kind: 'terms'; terms: string[] }

export interface Overlap {
  decision: Decision
  reasons: OverlapReason[]
}

export interface ReviewPage {
  decision: Decision
  feature: Feature | undefined
  /** The main decision of the feature, or the parent the record declares. */
  detailOf: Decision | undefined
  /** Decisions with a relation, a cited file or a term in common. */
  overlaps: Overlap[]
  /** The other decisions of the feature, without any other reason. */
  sameFeature: Decision[]
  /** Files that the proposal cites, where a code note would go. */
  files: string[]
}

// A term that more decisions use says nothing about this one.
const COMMON_TERM = 6
const BACKTICKS = /`([^`\n]+)`/g

/** Whether a decision still counts: in force, or proposed. */
function counts(decision: Decision): boolean {
  return isInForce(decision.status) && decision.status !== 'rejected'
}

function termsOf(decision: Decision): Set<string> {
  const markdown = [
    ...(decision.text?.relations ?? []),
    ...(decision.text?.sections.map(s => s.markdown) ?? []),
  ].join('\n')
  const terms = new Set<string>()
  for (const [, term] of markdown.matchAll(BACKTICKS)) {
    // `NAME=true` and `name()` name the same thing as `NAME` and `name`.
    const trimmed = term!.trim().replace(/=.*$|\(\)$/, '')
    // A path or a number is not a term: files have their own reason.
    if (trimmed.length < 4 || /^\d+$/.test(trimmed) || trimmed.includes('/'))
      continue
    terms.add(trimmed)
  }
  return terms
}

function citedFiles(report: DriftReport): Map<number, Set<string>> {
  const files = new Map<number, Set<string>>()
  for (const reference of report.references) {
    if (reference.kind !== 'path') continue
    const set = files.get(reference.decision) ?? new Set<string>()
    for (const path of reference.resolvedPaths) set.add(path)
    files.set(reference.decision, set)
  }
  return files
}

const pad = (n: number) => String(n).padStart(4, '0')

/** The page of a proposed decision, or undefined when the report lacks it. */
export function reviewPage(
  report: DriftReport,
  number: number
): ReviewPage | undefined {
  const decision = report.decisions.find(d => d.number === number)
  if (decision === undefined) return undefined
  const byNumber = new Map(report.decisions.map(d => [d.number, d]))
  const feature = (report.features ?? []).find(f =>
    f.decisions.includes(number)
  )
  const detailOf =
    feature?.main !== undefined &&
    feature.main !== null &&
    feature.main !== number
      ? byNumber.get(feature.main)
      : decision.parent === null
        ? undefined
        : byNumber.get(decision.parent)

  const files = citedFiles(report)
  const ownFiles = files.get(number) ?? new Set<string>()
  const allTerms = new Map(report.decisions.map(d => [d.number, termsOf(d)]))
  const usage = new Map<string, number>()
  for (const terms of allTerms.values()) {
    for (const term of terms) usage.set(term, (usage.get(term) ?? 0) + 1)
  }
  const ownTerms = [...(allTerms.get(number) ?? [])].filter(
    term => usage.get(term)! <= COMMON_TERM
  )

  const overlaps: Overlap[] = []
  const sameFeature: Decision[] = []
  for (const other of report.decisions) {
    if (other.number === number || !counts(other)) continue
    const reasons: OverlapReason[] = []
    if (decision.amends.includes(other.number)) {
      reasons.push({
        kind: 'relation',
        text: `This proposal amends ${pad(other.number)}`,
      })
    }
    if (
      other.amends.includes(number) ||
      decision.amendedBy.includes(other.number)
    ) {
      reasons.push({
        kind: 'relation',
        text: `${pad(other.number)} amends this proposal`,
      })
    }
    if (
      report.replacedRules?.some(
        r => r.decision === number && r.target === other.number
      )
    ) {
      reasons.push({
        kind: 'relation',
        text: `This proposal replaces a rule of ${pad(other.number)}`,
      })
    }
    const shared = [...(files.get(other.number) ?? [])].filter(f =>
      ownFiles.has(f)
    )
    if (shared.length > 0) reasons.push({ kind: 'files', files: shared.sort() })
    const otherTerms = allTerms.get(other.number)!
    const terms = ownTerms.filter(term => otherTerms.has(term))
    if (terms.length > 0) reasons.push({ kind: 'terms', terms: terms.sort() })
    if (reasons.length > 0) overlaps.push({ decision: other, reasons })
    else if (feature?.decisions.includes(other.number)) sameFeature.push(other)
  }
  const weight = (overlap: Overlap) =>
    overlap.reasons.reduce(
      (sum, reason) =>
        sum +
        (reason.kind === 'relation'
          ? 10
          : reason.kind === 'files'
            ? 3 * reason.files.length
            : 2 * reason.terms.length),
      feature?.decisions.includes(overlap.decision.number) ? 1 : 0
    )
  overlaps.sort(
    (a, b) => weight(b) - weight(a) || a.decision.number - b.decision.number
  )
  return {
    decision,
    feature,
    detailOf,
    overlaps,
    sameFeature,
    files: [...ownFiles].sort(),
  }
}
