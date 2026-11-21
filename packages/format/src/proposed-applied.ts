import type { Decision, DriftReport } from './report-schema.ts'

/** A proposed decision that the code already cites. */
export interface ProposedApplied {
  decision: Decision
  /** Files of the code that cite the decision, in path order. */
  files: string[]
}

/**
 * The proposed decisions that files of the code cite, in number order. The
 * code may apply such a decision while nobody accepted it: a person accepts
 * it, or says in the record why it waits.
 */
export function proposedApplied(
  report: Pick<DriftReport, 'decisions' | 'citations'>
): ProposedApplied[] {
  const files = new Map<number, Set<string>>()
  for (const citation of report.citations) {
    if (!citation.inCode) continue
    const set = files.get(citation.decision) ?? new Set<string>()
    set.add(citation.file)
    files.set(citation.decision, set)
  }
  return report.decisions
    .filter(d => d.status === 'proposed' && files.has(d.number))
    .sort((a, b) => a.number - b.number)
    .map(decision => ({
      decision,
      files: [...files.get(decision.number)!].sort(),
    }))
}
