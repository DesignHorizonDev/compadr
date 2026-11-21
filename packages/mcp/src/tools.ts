// What the MCP tools answer, computed from a drift report. These functions
// read the report only; the server feeds them and turns them into results.
import {
  compactDecisionsForFile,
  sectionHeadings,
  worstSignals,
  type CodeReference,
  type Decision,
  type DriftReport,
  type SignalLevel,
} from '@compadr/format'

// The record that `propose_decision` returns: the command line writes the
// same one into a local draft.
export { draftDecision, type Proposal } from '@compadr/engine'

function featureOf(report: DriftReport, number: number) {
  return report.features?.find(feature => feature.decisions.includes(number))
}

function cited(reference: CodeReference): string {
  if (reference.kind === 'symbol') return reference.symbol
  if (reference.anchor) return `${reference.path}#${reference.anchor.symbol}`
  return reference.text
}

/** How much of the code links `get_decision` gives. */
export const CODE_LINK_DETAILS = ['grouped', 'full', 'none'] as const
/** How much of the files that cite the record `get_decision` gives. */
export const CITED_BY_DETAILS = ['count', 'files', 'lines'] as const

export interface DescribeOptions {
  /**
   * `grouped`: one entry per cited path, with its number of citations and
   * its worst drift, and the cited symbols by name; `full`: every link;
   * `none`. The default is `grouped`, or `none` when `sections` picks some
   * subsections or none: the agent then reads the text or the outline, not
   * the links.
   */
  codeLinks?: (typeof CODE_LINK_DETAILS)[number]
  /** `count` (default), `files`, or `lines` with the line numbers. */
  citedBy?: (typeof CITED_BY_DETAILS)[number]
  /**
   * Subsections of the Decision section to give, by their `index` in
   * `outline` (from 1), `all` (default) or `none`.
   */
  sections?: number[] | 'all' | 'none'
}

const DRIFT_RANK: Record<SignalLevel, number> = {
  broken: 0,
  review: 1,
  order: 2,
  info: 3,
}

/** Everything the report knows about one decision, for `get_decision`. */
export function describeDecision(
  report: DriftReport,
  number: number,
  options: DescribeOptions = {}
) {
  const decision = report.decisions.find(d => d.number === number)
  if (decision === undefined) return null
  const feature = featureOf(report, number)
  const signals = worstSignals(report)
  const rules = report.replacedRules ?? []
  const sections = decision.text?.sections ?? []
  const wanted = options.sections ?? 'all'
  const codeLinks =
    options.codeLinks ??
    (options.sections === undefined || options.sections === 'all'
      ? 'grouped'
      : 'none')
  const citedBy = options.citedBy ?? 'count'
  const links = report.references.filter(r => r.decision === number)
  const citations = new Map<string, number[]>()
  for (const citation of report.citations) {
    if (citation.decision !== number) continue
    citations.set(citation.file, [
      ...(citations.get(citation.file) ?? []),
      citation.line,
    ])
  }
  return {
    number,
    title: decision.title,
    status: decision.status,
    rawStatus: decision.rawStatus,
    inForce: decision.status === 'accepted',
    file: decision.file,
    date: decision.date,
    lastEdit: decision.revisedAt,
    feature: feature ? { id: feature.id, label: feature.label } : null,
    mainDecision:
      feature?.main !== undefined && feature.main !== number
        ? feature.main
        : decision.parent,
    supersededBy: decision.supersededBy,
    amends: decision.amends,
    relations: decision.text?.relations ?? [],
    rule: decision.rule ?? null,
    // Numbered like `decision`: the text before the first subsection, when
    // there is one, is number 1 with no heading.
    outline: sections.map((section, index) => ({
      index: index + 1,
      heading: sectionHeadings([section])[0] ?? null,
    })),
    decision: sections
      .map((section, index) => ({
        index: index + 1,
        heading: section.heading,
        markdown: section.markdown,
      }))
      .filter(
        section =>
          wanted === 'all' ||
          (wanted !== 'none' && wanted.includes(section.index))
      ),
    replacesRules: rules
      .filter(rule => rule.decision === number)
      .map(rule => ({ quote: rule.quote, in: rule.target })),
    rulesReplacedLater: rules
      .filter(rule => rule.target === number)
      .map(rule => ({ quote: rule.quote, by: rule.decision })),
    codeLinks:
      codeLinks === 'none'
        ? []
        : codeLinks === 'full'
          ? links.map(reference => {
              const signal = signals.get(reference.id)
              return {
                cited: cited(reference),
                recordLine: reference.adrLine,
                citedAt: reference.citedAt,
                drift: signal
                  ? { level: signal.level, type: signal.type }
                  : null,
              }
            })
          : groupLinks(
              links.filter(reference => reference.kind === 'path'),
              signals
            ),
    ...(codeLinks === 'grouped'
      ? {
          citedSymbols: [
            ...new Set(
              links.flatMap(reference =>
                reference.kind === 'symbol' ? [reference.symbol] : []
              )
            ),
          ],
        }
      : {}),
    citedBy:
      citedBy === 'count'
        ? {
            files: citations.size,
            citations: [...citations.values()].reduce(
              (sum, lines) => sum + lines.length,
              0
            ),
          }
        : citedBy === 'files'
          ? [...citations.keys()]
          : [...citations].map(([file, lines]) => ({
              file,
              lines: lines.sort((a, b) => a - b),
            })),
  }
}

/**
 * One entry per cited path: how many times the record cites it, whether a
 * citation names lines or a symbol of it, and the worst drift.
 */
function groupLinks(
  links: readonly CodeReference[],
  signals: ReturnType<typeof worstSignals>
) {
  const groups = new Map<
    string,
    { cited: string; count: number; lines?: true; drift?: SignalLevel }
  >()
  for (const reference of links) {
    if (reference.kind !== 'path') continue
    const key = reference.path
    const group = groups.get(key) ?? { cited: key, count: 0 }
    group.count++
    if (reference.lines !== null || reference.anchor !== null) {
      group.lines = true
    }
    const level = signals.get(reference.id)?.level
    if (
      level !== undefined &&
      (group.drift === undefined || DRIFT_RANK[level] < DRIFT_RANK[group.drift])
    ) {
      group.drift = level
    }
    groups.set(key, group)
  }
  return [...groups.values()]
}

/**
 * The decisions behind a symbol that the records cite: those whose record
 * cites it, where the code declares it, and, when one file alone declares it,
 * the decisions in force of that file. Null when no record cites the symbol.
 */
export function decisionsForSymbol(report: DriftReport, symbol: string) {
  const references = report.references.filter(
    reference => reference.kind === 'symbol' && reference.symbol === symbol
  )
  if (references.length === 0) return null
  const first = references[0]
  const declaredIn = first?.kind === 'symbol' ? (first.declaredIn ?? []) : []
  const byNumber = new Map(report.decisions.map(d => [d.number, d]))
  const citedBy = [...new Set(references.map(r => r.decision))]
    .flatMap(number => {
      const decision = byNumber.get(number)
      if (decision === undefined) return []
      return [
        {
          decision: number,
          title: decision.title,
          status: decision.status,
          ...(decision.rule ? { rule: decision.rule.text } : {}),
        },
      ]
    })
    .sort(
      (a, b) =>
        Number(b.status === 'accepted') - Number(a.status === 'accepted') ||
        a.decision - b.decision
    )
  return {
    symbol,
    declaredIn,
    citedBy,
    ...(declaredIn.length === 1
      ? {
          fileDecisions: compactDecisionsForFile(report, declaredIn[0]!.file)
            .inForce,
        }
      : {}),
  }
}

/** Lowercase, without accents: `Décision` → `decision`. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export interface SearchOptions {
  status?: Decision['status']
  limit?: number
}

/**
 * Full-text search over the title, the relations and the decision text of
 * each record. Every word must match; a word of the title counts more.
 */
export function searchDecisions(
  report: DriftReport,
  query: string,
  options: SearchOptions = {}
) {
  const words = fold(query)
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean)
  if (words.length === 0) return []
  return report.decisions
    .filter(d => options.status === undefined || d.status === options.status)
    .flatMap(decision => {
      const title = fold(decision.title)
      const feature = fold(featureOf(report, decision.number)?.label ?? '')
      const sections = decision.text?.sections ?? []
      const body = fold(
        [
          ...(decision.text?.relations ?? []),
          ...sections.map(s => `${s.heading ?? ''}\n${s.markdown}`),
        ].join('\n')
      )
      let score = 0
      for (const word of words) {
        const inTitle = title.includes(word) || feature.includes(word)
        const inBody = body.split(word).length - 1
        if (!inTitle && inBody === 0) return []
        score += (inTitle ? 5 : 0) + Math.min(inBody, 5)
      }
      // The first line of the decision text that holds a word.
      const line = sections
        .flatMap(s => s.markdown.split('\n'))
        .find(l => words.some(word => fold(l).includes(word)))
      return [
        {
          number: decision.number,
          title: decision.title,
          status: decision.status,
          feature: featureOf(report, decision.number)?.id ?? null,
          score,
          excerpt: line ? line.trim().slice(0, 200) : null,
        },
      ]
    })
    .sort((a, b) => b.score - a.score || a.number - b.number)
    .slice(0, options.limit ?? 10)
}
