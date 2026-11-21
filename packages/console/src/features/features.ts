// How the feature map and the feature page present the features of a
// report. These functions read the report only; they hold no state.
import type {
  Decision,
  DriftReport,
  Feature,
  ReplacedRule,
} from '@compadr/format'
import {
  decisionLabel,
  DRIFT_LEVELS,
  type DriftLevel,
} from '../drift/signals.ts'
import type { Mark } from './markdown.tsx'

/** The drift of a decision: its worst signal, or none. */
export type DecisionState = DriftLevel | 'in-sync'

export function decisionStates(
  report: DriftReport
): Map<number, DecisionState> {
  const rank = (level: DecisionState) =>
    level === 'in-sync' ? DRIFT_LEVELS.length : DRIFT_LEVELS.indexOf(level)
  const states = new Map<number, DecisionState>(
    report.decisions.map(d => [d.number, 'in-sync'])
  )
  for (const signal of report.signals) {
    if (signal.level === 'info') continue
    const current = states.get(signal.decision)
    if (current !== undefined && rank(signal.level) < rank(current)) {
      states.set(signal.decision, signal.level)
    }
  }
  return states
}

export interface FeatureCard {
  feature: Feature
  main: Decision | undefined
  details: Decision[]
  states: DecisionState[]
  /** Rules that a decision of the feature quotes as replaced. */
  replaced: number
}

export interface FeatureMap {
  cards: FeatureCard[]
  /** Decisions that belong to no feature. */
  unassigned: Decision[]
  proposed: boolean
}

export function featureMap(report: DriftReport): FeatureMap {
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  const states = decisionStates(report)
  const features = report.features ?? []
  const grouped = new Set(features.flatMap(f => f.decisions))
  const cards = features.map(feature => {
    const members = feature.decisions.flatMap(n => decisions.get(n) ?? [])
    const replaced = (report.replacedRules ?? []).filter(rule =>
      feature.decisions.includes(rule.decision)
    ).length
    return {
      feature,
      main: feature.main === null ? undefined : decisions.get(feature.main),
      details: members.filter(d => d.number !== feature.main),
      states: members.map(d => states.get(d.number) ?? 'in-sync'),
      replaced,
    }
  })
  return {
    cards,
    unassigned: report.decisions.filter(d => !grouped.has(d.number)),
    proposed: features.some(f => f.source === 'proposed'),
  }
}

export interface ReadingSection {
  heading: string | null
  line: number
  markdown: string
  marks: Mark[]
}

export interface ReadingEntry {
  decision: Decision
  role: 'main' | 'detail'
  state: DecisionState
  /** Rules of older decisions that this decision replaces. */
  replaces: ReplacedRule[]
  /** Newer decisions outside the feature that change this one. */
  changedElsewhere: number[]
  sections: ReadingSection[]
}

/** Newer decisions that change each decision, as the engine links them. */
function changers(report: DriftReport): Map<number, Set<number>> {
  const sets = new Map<number, Set<number>>()
  const add = (target: number, newer: number) => {
    if (newer <= target) return
    sets.set(target, (sets.get(target) ?? new Set()).add(newer))
  }
  for (const d of report.decisions) {
    for (const target of d.amends) add(target, d.number)
    for (const newer of [...d.amendedBy, ...d.supersededBy]) {
      add(d.number, newer)
    }
  }
  return sets
}

/**
 * The rules in force of a feature, as an ordered reading: the main decision,
 * then its details in number order. A rule that a later decision replaces is
 * marked in the section where the engine found it.
 */
export function featureReading(
  report: DriftReport,
  feature: Feature
): ReadingEntry[] {
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  const states = decisionStates(report)
  const rules = report.replacedRules ?? []
  const changedBy = changers(report)
  const members = new Set(feature.decisions)
  const ordered = [
    ...(feature.main !== null && decisions.has(feature.main)
      ? [feature.main]
      : []),
    ...feature.decisions.filter(n => n !== feature.main).sort((a, b) => a - b),
  ]
  return ordered.map(number => {
    const decision = decisions.get(number)!
    const sections = (decision.text?.sections ?? []).map((section, index) => ({
      ...section,
      marks: rules
        .filter(
          rule => rule.target === number && rule.location?.section === index
        )
        .map(rule => ({
          start: rule.location!.start,
          end: rule.location!.end,
          title: `Replaced by ${decisionLabel(rule.decision)}`,
          note: decisionLabel(rule.decision),
        })),
    }))
    return {
      decision,
      role: number === feature.main ? ('main' as const) : ('detail' as const),
      state: states.get(number) ?? 'in-sync',
      replaces: rules.filter(rule => rule.decision === number),
      changedElsewhere: [...(changedBy.get(number) ?? [])]
        .filter(n => !members.has(n))
        .sort((a, b) => a - b),
      sections,
    }
  })
}

/** Where the engine found a replaced rule, in words. */
export function ruleWhereabouts(
  rule: ReplacedRule,
  decisions: ReadonlyMap<number, Decision>
): string {
  if (rule.target === null) return 'Not found in the decisions it names.'
  const target = decisionLabel(rule.target)
  if (rule.location === null) {
    return `Found in ${target}, outside its Decision section.`
  }
  const heading = decisions.get(rule.target)?.text?.sections[
    rule.location.section
  ]?.heading
  return heading
    ? `Struck through in ${target}, section “${heading}”.`
    : `Struck through in ${target}.`
}
