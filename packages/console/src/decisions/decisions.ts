// How the Decisions view presents one decision of a report: its code links
// with their date and state, the files that cite it, and its text. These
// functions read the report only; they hold no state.
import { shellArgument, shellQuote } from '../review/commands.ts'
import type {
  AdrCitation,
  Attribution,
  CodeReference,
  Decision,
  DriftReport,
  Feature,
  ReplacedRule,
  Signal,
} from '@compadr/format'
import {
  decisionLabel,
  DRIFT_LEVELS,
  SIGNAL_TITLES,
  type DriftLevel,
} from '../drift/signals.ts'
import { decisionStates, type DecisionState } from '../features/features.ts'
import type { Mark } from '../features/markdown.tsx'

export interface DecisionRow {
  decision: Decision
  state: DecisionState
  feature: Feature | undefined
  links: number
  citations: number
}

function featureOf(report: DriftReport, number: number): Feature | undefined {
  return report.features?.find(feature => feature.decisions.includes(number))
}

/** One row per decision, in number order. */
export function decisionRows(report: DriftReport): DecisionRow[] {
  const states = decisionStates(report)
  return [...report.decisions]
    .sort((a, b) => a.number - b.number)
    .map(decision => ({
      decision,
      state: states.get(decision.number) ?? 'in-sync',
      feature: featureOf(report, decision.number),
      links: report.references.filter(r => r.decision === decision.number)
        .length,
      citations: report.citations.filter(c => c.decision === decision.number)
        .length,
    }))
}

/** The worst drift signal of each reference, by reference identifier. */
export function referenceSignals(report: DriftReport): Map<string, Signal> {
  const rank = (signal: Signal) =>
    (DRIFT_LEVELS as readonly string[]).indexOf(signal.level)
  const worst = new Map<string, Signal>()
  for (const signal of report.signals) {
    if (signal.level === 'info' || !('reference' in signal)) continue
    const current = worst.get(signal.reference)
    if (current === undefined || rank(signal) < rank(current)) {
      worst.set(signal.reference, signal)
    }
  }
  return worst
}

export interface CodeLink {
  reference: CodeReference
  /** The worst drift of the reference, or null when it is in sync. */
  level: DriftLevel | null
  title: string
}

export interface CitingFile {
  file: string
  lines: number[]
  inCode: boolean
}

export interface DecisionPage {
  decision: Decision
  state: DecisionState
  feature: Feature | undefined
  /** Main decision of the feature, when this one is a detail. */
  main: number | null
  links: CodeLink[]
  citedBy: CitingFile[]
  /** Rules of older decisions that this one replaces. */
  replaces: ReplacedRule[]
  /** Marks of the rules of this decision that later decisions replace. */
  marks: Mark[][]
}

function linkState(
  reference: CodeReference,
  signal: Signal | undefined
): Pick<CodeLink, 'level' | 'title'> {
  if (signal !== undefined && signal.level !== 'info') {
    return { level: signal.level, title: SIGNAL_TITLES[signal.type] }
  }
  if (reference.kind === 'symbol') {
    return {
      level: null,
      title: reference.foundInCode ? 'Symbol found in the code' : 'Not checked',
    }
  }
  if (reference.anchor !== null) {
    return { level: null, title: 'Anchored symbol in sync' }
  }
  return {
    level: null,
    title:
      reference.resolvedPaths.length > 0 ? 'Path found' : 'Path not checked',
  }
}

function citingFiles(citations: AdrCitation[]): CitingFile[] {
  const files = new Map<string, CitingFile>()
  for (const citation of citations) {
    const entry = files.get(citation.file) ?? {
      file: citation.file,
      lines: [],
      inCode: citation.inCode,
    }
    entry.lines.push(citation.line)
    files.set(citation.file, entry)
  }
  return [...files.values()]
    .map(entry => ({ ...entry, lines: entry.lines.sort((a, b) => a - b) }))
    .sort(
      (a, b) =>
        Number(b.inCode) - Number(a.inCode) || a.file.localeCompare(b.file)
    )
}

export function decisionPage(
  report: DriftReport,
  number: number
): DecisionPage | undefined {
  const decision = report.decisions.find(d => d.number === number)
  if (decision === undefined) return undefined
  const signals = referenceSignals(report)
  const feature = featureOf(report, number)
  const rules = report.replacedRules ?? []
  return {
    decision,
    state: decisionStates(report).get(number) ?? 'in-sync',
    feature,
    main:
      feature?.main !== undefined && feature.main !== number
        ? feature.main
        : decision.parent,
    links: report.references
      .filter(reference => reference.decision === number)
      .sort((a, b) => a.adrLine - b.adrLine)
      .map(reference => ({
        reference,
        ...linkState(reference, signals.get(reference.id)),
      })),
    citedBy: citingFiles(report.citations.filter(c => c.decision === number)),
    replaces: rules.filter(rule => rule.decision === number),
    marks: (decision.text?.sections ?? []).map((_, index) =>
      rules
        .filter(
          rule => rule.target === number && rule.location?.section === index
        )
        .map(rule => ({
          start: rule.location!.start,
          end: rule.location!.end,
          title: `Replaced by ${decisionLabel(rule.decision)}`,
          note: decisionLabel(rule.decision),
        }))
    ),
  }
}

/** The command that records references as checked, on a pull request. */
export function markCheckedCommand(ref: string, references: string[]): string {
  return [
    'compadr mark-checked .',
    `--ref ${shellQuote(ref)}`,
    ...[...references].sort().map(id => `--reference ${shellArgument(id)}`),
    '--open-pr',
  ].join(' ')
}

export interface HistoryEntry {
  date: string
  /** A commit of the record, or the check of one of its references. */
  kind: 'commit' | 'check'
  commit: string | null
  text: string
  /** The author of the commit, or the person who checked. */
  by: Attribution | null
}

/** A name and where it comes from, as the page shows it. */
export function describeAttribution(attribution: Attribution): string {
  const names = attribution.names.join(', ')
  const pull = attribution.pullRequest
  if (attribution.source === 'pull-request' && pull !== undefined) {
    return `${names} (${pull.role} #${pull.number})`
  }
  return attribution.source === 'declared' ? names : `${names} (commit author)`
}

/** The label of the attribution of a record in its page header. */
export function attributionLabel(attribution: Attribution): string {
  if (attribution.source === 'declared') return 'Decided by'
  if (attribution.source === 'pull-request') {
    return attribution.pullRequest?.role === 'approved'
      ? 'Approved by'
      : 'Merged by'
  }
  return 'Written by'
}

/** The commits of a record and the checks of its references, newest first. */
export function decisionHistory(
  report: DriftReport,
  number: number
): HistoryEntry[] {
  const decision = report.decisions.find(d => d.number === number)
  const commits: HistoryEntry[] = (decision?.history ?? []).map(entry => ({
    date: entry.date,
    kind: 'commit',
    commit: entry.commit,
    text: entry.subject,
    by: entry.author ? { names: [entry.author], source: 'commit' } : null,
  }))
  const checks: HistoryEntry[] = report.references
    .filter(r => r.decision === number && r.checkedAt)
    .map(r => ({
      date: r.checkedAt!,
      kind: 'check',
      commit: null,
      text: r.text,
      by: r.checkedBy ?? null,
    }))
  return [...commits, ...checks].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? 1 : -1
  )
}
