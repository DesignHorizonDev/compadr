// The correction that adds a proposed decision record, drafted by the assist
// service from a change. The record keeps the status proposed: a model
// drafts, a person reviews the draft, and accepts the decision later.
import {
  draftDecision,
  proposalOfDraft,
  recordLanguage,
  type ProposedRecord,
} from '@compadr/engine'
import type { DraftSuggestion, DriftReport } from '@compadr/format'
import type { Correction } from './publish.ts'

export class ProposeCommandError extends Error {}

const pad = (n: number) => String(n).padStart(4, '0')

const TEXTS = {
  en: {
    title: (n: number) => `docs(adr): propose ADR ${pad(n)}`,
    body: (n: number, change: string, model: string, prompt: string) =>
      `The assist service drafted ADR ${pad(n)} from ${change} (${model}, ${prompt}). The record stays proposed: a person reviews it, and accepts the decision later.`,
    change: (base: string, head: string) => `the change ${base}...${head}`,
    diff: (head: string) => `a diff on commit ${head}`,
  },
  fr: {
    title: (n: number) => `docs(adr): proposer l'ADR ${pad(n)}`,
    body: (n: number, change: string, model: string, prompt: string) =>
      `Le service d'assistance a rédigé l'ADR ${pad(n)} à partir ${change} (${model}, ${prompt}). L'ADR reste proposé : une personne le relit, puis accepte la décision plus tard.`,
    change: (base: string, head: string) => `du changement ${base}...${head}`,
    diff: (head: string) => `d'un diff sur le commit ${head}`,
  },
}

export interface ProposeChange {
  /** Commit where the change leaves its base; null for a diff in a file. */
  base: string | null
  /** Last commit of the change. */
  head: string
}

/**
 * The record that a draft suggestion makes, written like the latest record
 * of `report`, and the commit that adds it.
 */
export function buildProposeCorrection(
  repository: string,
  report: DriftReport,
  suggestion: DraftSuggestion,
  change: ProposeChange,
  latest: string | null,
  today: string
): { correction: Correction; record: ProposedRecord } {
  if (suggestion.notNeeded !== null) {
    throw new ProposeCommandError(
      `the change needs no new record: ${suggestion.notNeeded}`
    )
  }
  if (suggestion.title.trim() === '') {
    throw new ProposeCommandError('the suggestion has no title')
  }
  const record = draftDecision(
    report,
    proposalOfDraft(suggestion),
    latest,
    today
  )
  if (report.decisions.some(d => d.file === record.path)) {
    throw new ProposeCommandError(`${record.path} already exists`)
  }
  const texts = TEXTS[recordLanguage(report)]
  const commit = report.repository.commit
  return {
    record,
    correction: {
      repository,
      commit,
      branch: `compadr/propose-${pad(record.number)}-${commit.slice(0, 8)}`,
      title: texts.title(record.number),
      body: texts.body(
        record.number,
        change.base === null
          ? texts.diff(change.head.slice(0, 8))
          : texts.change(change.base.slice(0, 8), change.head.slice(0, 8)),
        suggestion.provenance.model,
        suggestion.provenance.promptVersion
      ),
      files: new Map([[record.path, record.content]]),
    },
  }
}
