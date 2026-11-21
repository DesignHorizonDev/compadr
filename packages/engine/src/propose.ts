// A new decision record with the status `proposed`, written like the latest
// record of the repository. The MCP tool `propose_decision` returns it, and
// `compadr assist draft` writes it into a local draft from the suggestion of
// the assist service. A person accepts it, by merging the pull request.
import {
  applyFeatureEdit,
  applyRuleEdit,
  FEATURE_ID,
  isInForce,
  isWeakRule,
  type DraftSuggestion,
  type DriftReport,
} from '@compadr/format'
import { MAX_DECISION_CHARACTERS } from './check.ts'
import { featureId } from './features.ts'

export interface Proposal {
  title: string
  context?: string
  decision?: string
  consequences?: string
  feature?: string
  /** Main decision that this one details. */
  parent?: number
  /** What the decision requires, in one sentence (`compadr.rule`). */
  rule?: string
  /** Other decisions that this one amends. */
  amends?: number[]
  /** Decisions that this one replaces. */
  supersedes?: number[]
}

export interface ProposedRecord {
  path: string
  number: number
  content: string
  notes: string[]
}

const pad = (n: number) => String(n).padStart(4, '0')

const STATUS_LINE =
  /^([ \t]*(?:[-*][ \t]+)?\**(Status|Statut)\**[ \t]*:[ \t]*\**[ \t]*)(\S.*)$/im
const DATE_LINE =
  /^([ \t]*(?:[-*][ \t]+)?\**Date\**[ \t]*:[ \t]*\**[ \t]*)(\d{4}-\d{2}-\d{2})(.*)$/im
const TITLE_LINE = /^#[ \t]+(ADR[- ]?)?(\d{1,4})([ \t]*[.:—–-][ \t]*|[ \t]+)/i

const SECTIONS = {
  en: {
    context: 'Context',
    decision: 'Decision',
    consequences: 'Consequences',
  },
  fr: {
    context: 'Contexte',
    decision: 'Décision',
    consequences: 'Conséquences',
  },
}

const RELATIONS = {
  en: {
    amends: (n: number) => `Amends ADR ${pad(n)}.`,
    supersedes: (n: number) => `Supersedes ADR ${pad(n)}.`,
  },
  fr: {
    amends: (n: number) => `Complète l'ADR ${pad(n)}.`,
    supersedes: (n: number) => `Remplace l'ADR ${pad(n)}.`,
  },
}

function featureOf(report: DriftReport, number: number) {
  return report.features?.find(feature => feature.decisions.includes(number))
}

/**
 * The record of a proposal, written like the latest record of the
 * repository: its title line, its status line and its sections, with the
 * status `proposed`. Without a record to follow, it uses MADR.
 */
export function draftDecision(
  report: DriftReport,
  proposal: Proposal,
  latest: string | null,
  today: string
): ProposedRecord {
  const notes: string[] = []
  const number = Math.max(0, ...report.decisions.map(d => d.number)) + 1
  const slug =
    featureId(proposal.title) === 'feature'
      ? 'decision'
      : featureId(proposal.title)
  const path = `${report.repository.adrDir}/${pad(number)}-${slug}.md`
  const template = (latest ?? '').replace(/\r\n?/g, '\n')
  const french =
    /^##[ \t]+(?:Contexte|Décision|Conséquences)\b|Statut\**[ \t]*:/im.test(
      template
    )
  const words = SECTIONS[french ? 'fr' : 'en']
  const relations = RELATIONS[french ? 'fr' : 'en']

  const header: string[] = []
  const titleMatch = TITLE_LINE.exec(
    template.split('\n').find(l => l.startsWith('# ')) ?? ''
  )
  header.push(
    titleMatch
      ? `# ${titleMatch[1] ?? ''}${String(number).padStart(titleMatch[2]!.length, '0')}${titleMatch[3]}${proposal.title}`
      : `# ${number}. ${proposal.title}`
  )
  header.push('')
  const statusMatch = STATUS_LINE.exec(template)
  const usesFrontmatterStatus = /^---\n[\s\S]*?^status:/m.test(template)
  if (statusMatch && !usesFrontmatterStatus) {
    // The value follows the language of the label: Status or Statut.
    const proposed = /statut/i.test(statusMatch[2]!) ? 'proposée' : 'Proposed'
    header.push(`${statusMatch[1]}${proposed}`)
    const dateMatch = DATE_LINE.exec(template)
    if (dateMatch) header.push(`${dateMatch[1]}${today}`)
  }
  // One line per relation, in the words that the parser of the records reads.
  const amends = [
    ...new Set([
      ...(proposal.parent === undefined ? [] : [proposal.parent]),
      ...(proposal.amends ?? []),
    ]),
  ]
  const supersedes = [...new Set(proposal.supersedes ?? [])].filter(
    n => !amends.includes(n)
  )
  const bullet = statusMatch?.[1]?.trimStart().startsWith('-') ? '- ' : ''
  for (const n of amends) header.push(`${bullet}${relations.amends(n)}`)
  for (const n of supersedes) header.push(`${bullet}${relations.supersedes(n)}`)

  const placeholder = french ? '_À compléter._' : '_To be written._'
  // The form that agents read best: one rule per subsection, each with the
  // code it applies to.
  const decisionPlaceholder = french
    ? '_À compléter : une règle par sous-section (`###`), chacune avec les fichiers ou les symboles qu’elle vise, entre backticks._'
    : '_To be written: one rule per subsection (`###`), each with the files or symbols it applies to, between backticks._'
  const sections = [
    [words.context, proposal.context, placeholder],
    [words.decision, proposal.decision, decisionPlaceholder],
    [words.consequences, proposal.consequences, placeholder],
  ].flatMap(([heading, text, empty]) => [
    '',
    `## ${heading}`,
    '',
    text?.trim() || empty,
  ])

  let content = [...header, ...sections, ''].join('\n')
  if (usesFrontmatterStatus || !statusMatch) {
    content = `---\nstatus: proposed\ndate: ${today}\n---\n\n${content}`
  }

  for (const n of [...amends, ...supersedes]) {
    if (!report.decisions.some(d => d.number === n)) {
      notes.push(`ADR ${pad(n)} is not in the repository.`)
    }
  }
  // The feature of the main decision, or the one feature that the
  // repository declares for the decisions that the proposal changes. A
  // feature that Compadr proposes has no stable identifier: it stays out.
  const related = [
    ...new Set(
      [...amends, ...supersedes].flatMap(n => {
        const found = featureOf(report, n)
        return found?.source === 'declared' ? [found.id] : []
      })
    ),
  ]
  const feature =
    proposal.feature ??
    (proposal.parent !== undefined
      ? featureOf(report, proposal.parent)?.id
      : related.length === 1
        ? related[0]
        : undefined)
  if (feature !== undefined) {
    if (!FEATURE_ID.test(feature)) {
      notes.push(`"${feature}" is not a feature identifier: it was left out.`)
    } else {
      if (
        !report.features?.some(f => f.id === feature && f.source === 'declared')
      ) {
        notes.push(
          `The repository does not declare the feature "${feature}" yet.`
        )
      }
      content = applyFeatureEdit(content, {
        feature,
        parent: proposal.parent ?? null,
      })
    }
  }
  if ((proposal.decision?.trim().length ?? 0) > MAX_DECISION_CHARACTERS) {
    notes.push(
      `The decision has more than ${MAX_DECISION_CHARACTERS} characters: an agent reads it whole. Give one rule per subsection, and split a decision that covers several features.`
    )
  }
  const rule = proposal.rule?.trim().replace(/\s+/g, ' ') ?? ''
  if (rule === '') {
    notes.push(
      'The record declares no rule: add compadr.rule, one sentence that says what the decision requires.'
    )
  } else {
    if (isWeakRule(rule)) {
      notes.push(
        'The rule is too short to stand alone: say in one sentence what the decision requires.'
      )
    }
    content = applyRuleEdit(content, rule)
  }
  notes.push(
    `The number ${pad(number)} follows the last record of ${report.repository.ref}: a pull request still open may use it.`,
    'An agent proposes a decision; a person accepts it, by merging the pull request.'
  )
  return { path, number, content, notes }
}

/** The proposal that a draft suggestion of the assist service makes. */
export function proposalOfDraft(suggestion: DraftSuggestion): Proposal {
  return {
    title: suggestion.title,
    rule: suggestion.rule,
    context: suggestion.context,
    decision: suggestion.decision
      .map(section => `### ${section.heading.trim()}\n\n${section.text.trim()}`)
      .join('\n\n'),
    consequences: suggestion.consequences,
    amends: suggestion.amends,
    supersedes: suggestion.supersedes,
  }
}

/** A decision in force that a proposal seems to repeat. */
export interface CloseDecision {
  number: number
  title: string
  /** Words of the proposal that the decision shares. */
  shared: string[]
}

/** Words shorter than this tell nothing about the subject. */
const MIN_WORD = 4
/** Shared words, at least, for a decision to count as close. */
export const CLOSE_MIN_SHARED = 3
/** Part of the words of the shorter text that the other one shares. */
export const CLOSE_MIN_OVERLAP = 0.5

function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(word => word.length >= MIN_WORD)
      // A plural names the same thing: "tokens" and "token", "jetons" and
      // "jeton", "hachés" and "haché".
      .map(word => (word.length > MIN_WORD ? word.replace(/[sx]$/, '') : word))
  )
}

/**
 * The decisions in force whose title and rule share most of their words
 * with the title and the rule of a proposal: the proposal may repeat one of
 * them, which a person then amends instead. The decisions that the proposal
 * names as amended or replaced are not counted. Deterministic: no model.
 */
export function closeDecisions(
  report: DriftReport,
  proposal: Pick<Proposal, 'title' | 'rule' | 'amends' | 'supersedes'>
): CloseDecision[] {
  const named = new Set([
    ...(proposal.amends ?? []),
    ...(proposal.supersedes ?? []),
  ])
  const own = wordsOf(`${proposal.title} ${proposal.rule ?? ''}`)
  if (own.size === 0) return []
  return report.decisions
    .filter(d => isInForce(d.status) && !named.has(d.number))
    .flatMap(decision => {
      const theirs = wordsOf(`${decision.title} ${decision.rule?.text ?? ''}`)
      const shared = [...own].filter(word => theirs.has(word))
      const overlap = shared.length / Math.min(own.size, theirs.size || 1)
      return shared.length >= CLOSE_MIN_SHARED && overlap >= CLOSE_MIN_OVERLAP
        ? [{ number: decision.number, title: decision.title, shared, overlap }]
        : []
    })
    .sort((a, b) => b.overlap - a.overlap || a.number - b.number)
    .slice(0, 3)
    .map(({ number, title, shared }) => ({ number, title, shared }))
}
