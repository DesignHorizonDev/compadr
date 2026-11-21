// How the Drift view presents the signals of a report. These functions read
// the report only; they hold no state.
import type {
  CodeReference,
  Decision,
  DriftReport,
  Signal,
  SignalLevel,
  SignalType,
} from '@compadr/format'
import { count } from '../format.ts'

/** Levels shown by the Drift view. `info` belongs to the health of the corpus. */
export const DRIFT_LEVELS = ['broken', 'review', 'order'] as const
export type DriftLevel = (typeof DRIFT_LEVELS)[number]

export const LEVELS: Record<
  DriftLevel,
  { label: string; symbol: string; hint: string }
> = {
  broken: {
    label: 'Broken',
    symbol: '✗',
    hint: 'Certain drift: the decision no longer matches the code.',
  },
  review: {
    label: 'To review',
    symbol: '⚠',
    hint: 'Probable drift: the cited code changed since its citation.',
  },
  order: {
    label: 'Review order',
    symbol: '↻',
    hint: 'Changes that order the review, without alert.',
  },
}

export const SIGNAL_TITLES: Record<SignalType, string> = {
  'path-missing': 'Cited path no longer exists',
  'cited-line-out-of-range': 'Cited line is beyond the end of the file',
  'cited-line-changed': 'Cited line changed after its citation',
  'cited-file-changed': 'Cited file changed since the citation',
  'linked-files-changed': 'Linked files changed since their citation',
  'superseded-decision-cited': 'Superseded decision still cited in code',
  'unknown-decision-cited': 'Code cites an unknown decision',
  'index-status-mismatch': 'Status differs from the index',
  'anchor-symbol-missing': 'Anchored symbol no longer exists',
  'anchor-symbol-ambiguous': 'Several symbols bear the anchored name',
  'anchor-content-changed': 'Anchored symbol changed since its fingerprint',
  'anchor-lines-changed': 'Tracked lines no longer found in the symbol',
  'anchor-unverified': 'Anchored reference cannot be checked',
  'amendment-chain': 'Decision changed by three decisions or more',
  'decision-without-code': 'Accepted decision with no link to the code',
}

/** Short names of the signal types, for the counts of the indicators. */
export const SIGNAL_COUNTS: Record<SignalType, [one: string, other: string]> = {
  'path-missing': ['missing path', 'missing paths'],
  'cited-line-out-of-range': ['line out of file', 'lines out of file'],
  'cited-line-changed': ['changed line', 'changed lines'],
  'cited-file-changed': ['changed file', 'changed files'],
  'linked-files-changed': [
    'decision with linked changes',
    'decisions with linked changes',
  ],
  'superseded-decision-cited': ['superseded citation', 'superseded citations'],
  'unknown-decision-cited': ['unknown decision', 'unknown decisions'],
  'index-status-mismatch': ['index mismatch', 'index mismatches'],
  'anchor-symbol-missing': ['missing symbol', 'missing symbols'],
  'anchor-symbol-ambiguous': ['ambiguous symbol', 'ambiguous symbols'],
  'anchor-content-changed': ['changed symbol', 'changed symbols'],
  'anchor-lines-changed': ['moved lines', 'moved lines'],
  'anchor-unverified': ['unverified anchor', 'unverified anchors'],
  'amendment-chain': ['amendment chain', 'amendment chains'],
  'decision-without-code': ['decision without code', 'decisions without code'],
}

export function countSignals(type: SignalType, count: number): string {
  const [one, other] = SIGNAL_COUNTS[type]
  return `${count} ${count === 1 ? one : other}`
}

export type DriftSignal = Extract<Signal, { level: DriftLevel }>

export function isDriftSignal(signal: Signal): signal is DriftSignal {
  return (DRIFT_LEVELS as readonly SignalLevel[]).includes(signal.level)
}

/** Lookups over one report, built once per report. */
export interface ReportIndex {
  report: DriftReport
  decision(number: number): Decision | undefined
  reference(id: string): CodeReference | undefined
}

export function indexReport(report: DriftReport): ReportIndex {
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  const references = new Map(report.references.map(r => [r.id, r]))
  return {
    report,
    decision: number => decisions.get(number),
    reference: id => references.get(id),
  }
}

export function decisionLabel(number: number): string {
  return `ADR-${String(number).padStart(4, '0')}`
}

/** `Oct 4, 2026`, in UTC so that every viewer reads the same date. */
export function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(timestamp))
}

/** What the cited text points to: the path with its lines, or the symbol. */
export function referenceTarget(reference: CodeReference): string {
  if (reference.kind === 'symbol') return reference.symbol
  if (reference.anchor) return `${reference.path}#${reference.anchor.symbol}`
  if (!reference.lines) return reference.path
  const { start, end } = reference.lines
  return start === end
    ? `${reference.path}:${start}`
    : `${reference.path}:${start}-${end}`
}

export interface SignalRow {
  signal: DriftSignal
  title: string
  /** Code element shown under the title. */
  target: string
  /** Short complement of the target, or null. */
  note: string | null
  decision: Decision | undefined
  /** Feature of the decision, or the folder of code most linked to it. */
  area: string | null
  /** Date the drift relates to, or null. */
  citedAt: string | null
}

export function describeSignal(
  index: ReportIndex,
  signal: DriftSignal
): SignalRow {
  const decision = index.decision(signal.decision)
  const base = {
    signal,
    title: SIGNAL_TITLES[signal.type],
    decision,
    area: decision?.feature ?? decision?.codeArea ?? null,
  }
  switch (signal.type) {
    case 'path-missing':
    case 'cited-line-out-of-range':
    case 'cited-line-changed':
    case 'cited-file-changed':
    case 'anchor-symbol-missing':
    case 'anchor-symbol-ambiguous':
    case 'anchor-content-changed':
    case 'anchor-lines-changed': {
      const reference = index.reference(signal.reference)
      const target = reference ? referenceTarget(reference) : signal.reference
      const note =
        signal.type === 'cited-line-out-of-range'
          ? `the file has ${count(signal.fileLineCount, 'line')}`
          : signal.type === 'cited-file-changed'
            ? `${count(signal.commitsSince, 'commit')} since`
            : signal.type === 'anchor-symbol-ambiguous'
              ? `${signal.matches} matches`
              : null
      return { ...base, target, note, citedAt: reference?.citedAt ?? null }
    }
    case 'linked-files-changed': {
      const [first, ...others] = signal.files
      return {
        ...base,
        target: first?.path ?? 'no file listed',
        note: others.length > 0 ? `and ${count(others.length, 'file')}` : null,
        citedAt: signal.oldestCitedAt,
      }
    }
    case 'superseded-decision-cited':
      return {
        ...base,
        target: `${signal.file}:${signal.line}`,
        note: `replaced by ${signal.supersededBy.map(decisionLabel).join(', ')}`,
        citedAt: null,
      }
    case 'unknown-decision-cited':
      return {
        ...base,
        target: `${signal.file}:${signal.line}`,
        note: null,
        citedAt: null,
      }
    case 'index-status-mismatch':
      return {
        ...base,
        target: `index: ${signal.indexStatus}, record: ${signal.recordStatus}`,
        note: null,
        citedAt: null,
      }
  }
}

/** Drift signals, most severe first, then by decision. */
export function driftRows(index: ReportIndex): SignalRow[] {
  const rank = (level: DriftLevel) => DRIFT_LEVELS.indexOf(level)
  return index.report.signals
    .filter(isDriftSignal)
    .sort(
      (a, b) =>
        rank(a.level) - rank(b.level) ||
        a.decision - b.decision ||
        a.id.localeCompare(b.id)
    )
    .map(signal => describeSignal(index, signal))
}

export interface LevelSummary {
  level: DriftLevel
  count: number
  /** Count per signal type, most frequent first. */
  types: { type: SignalType; count: number }[]
}

export function summarizeLevels(rows: SignalRow[]): LevelSummary[] {
  return DRIFT_LEVELS.map(level => {
    const types = new Map<SignalType, number>()
    let count = 0
    for (const { signal } of rows) {
      if (signal.level !== level) continue
      count += 1
      types.set(signal.type, (types.get(signal.type) ?? 0) + 1)
    }
    return {
      level,
      count,
      types: [...types]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    }
  })
}

/**
 * Share of anchored path links, rounded down so that 100 % means every link.
 * A dash when the report has no path link.
 */
export function anchoredShare({
  paths,
  anchored,
}: {
  paths: number
  anchored: number
}): string {
  return paths === 0 ? '–' : `${Math.floor((100 * anchored) / paths)} %`
}

/** Path links of the report, and how many are anchored on a symbol. */
export function anchoring(report: DriftReport): {
  paths: number
  anchored: number
} {
  const paths = report.references.filter(r => r.kind === 'path')
  return {
    paths: paths.length,
    anchored: paths.filter(r => r.anchor !== null).length,
  }
}
