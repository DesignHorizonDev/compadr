// `compadr rules`: a person validates the rules in force that the assist
// service consolidated for a feature. The suggestion must answer the chain of
// the main decision as it is now, and passes the guard again; the rules then
// go into features.yml, with the fingerprint of each record of the chain.
import { keepAccepted } from '@compadr/assist'
import {
  amendmentChain,
  assistInputHash,
  buildConsolidateRequest,
  recordHash,
  verifySuggestion,
  type ReadRecord,
} from '@compadr/engine'
import {
  AssistSuggestionSchema,
  FEATURE_GLOSSARY,
  writeValidatedRules,
  type DriftReport,
  type ValidatedRules,
} from '@compadr/format'
import type { Correction } from './publish.ts'

export class RulesCommandError extends Error {}

const pad = (n: number) => String(n).padStart(4, '0')

/** The suggestion of a file: the output of `compadr assist`, or the suggestion alone. */
function readSuggestion(json: unknown) {
  const value =
    typeof json === 'object' && json !== null && 'suggestion' in json
      ? json.suggestion
      : json
  const parsed = AssistSuggestionSchema.safeParse(value)
  if (!parsed.success) {
    throw new RulesCommandError(
      'the file holds no assist suggestion: pass the output of compadr assist consolidate'
    )
  }
  if (parsed.data.kind !== 'consolidate') {
    throw new RulesCommandError(
      `the file holds a ${parsed.data.kind} suggestion, not a consolidate one`
    )
  }
  return parsed.data
}

export async function buildRulesCorrection(
  repository: string,
  report: DriftReport,
  featureId: string,
  json: unknown,
  request: { branch?: string; title?: string; body?: string },
  readRecord: ReadRecord,
  readFile: (path: string) => Promise<string | null>,
  today: string
): Promise<Correction> {
  const feature = report.features?.find(f => f.id === featureId)
  if (feature === undefined || feature.source !== 'declared') {
    throw new RulesCommandError(
      `the repository declares no feature ${featureId}`
    )
  }
  if (feature.main === null) {
    throw new RulesCommandError(
      `the feature ${featureId} has no main decision, so no chain to consolidate`
    )
  }
  const main = feature.main
  const suggestion = readSuggestion(json)
  const consolidate = await buildConsolidateRequest(report, main, readRecord)
  if (suggestion.provenance.inputHash !== assistInputHash(consolidate)) {
    throw new RulesCommandError(
      `the suggestion does not answer the chain of ADR ${pad(main)} at commit ${report.repository.commit.slice(0, 8)}: run compadr assist consolidate --decision ${main} on the same reference, then compadr rules`
    )
  }
  const kept = keepAccepted(
    suggestion,
    verifySuggestion(consolidate, suggestion, report)
  ).suggestion
  if (kept === null || kept.kind !== 'consolidate' || kept.rules.length === 0) {
    throw new RulesCommandError(
      'the guard keeps no rule of the suggestion: nothing to validate'
    )
  }

  const files = new Map(report.decisions.map(d => [d.number, d.file]))
  const chain: ValidatedRules['chain'] = []
  for (const number of amendmentChain(report, main)) {
    chain.push({
      decision: number,
      hash: recordHash(await readRecord(files.get(number)!)),
    })
  }
  const rules: ValidatedRules = {
    decision: main,
    validated: today,
    model: kept.provenance.model,
    promptVersion: kept.provenance.promptVersion,
    chain,
    rules: kept.rules,
    replaced: kept.replaced,
    conflicts: kept.conflicts,
  }
  const glossaryPath = `${report.repository.adrDir}/${FEATURE_GLOSSARY}`
  const glossary = await readFile(glossaryPath)
  if (glossary === null) {
    throw new RulesCommandError(`${glossaryPath} does not exist`)
  }
  const commit = report.repository.commit
  return {
    repository,
    commit,
    branch:
      request.branch ?? `compadr/rules-${featureId}-${commit.slice(0, 8)}`,
    title:
      request.title ??
      `docs(adr): validate the rules in force of ${feature.label}`,
    body:
      request.body ??
      [
        `The rules in force of ${feature.label}, consolidated along the amendments of ADR ${pad(main)} (${chain.map(c => pad(c.decision)).join(', ')}).`,
        '',
        ...rules.rules.map(
          rule =>
            `- ${rule.rule} (${rule.sources.map(n => `ADR ${pad(n)}`).join(', ')})`
        ),
        ...(rules.conflicts.length === 0
          ? []
          : [
              '',
              'Points that the records leave open:',
              ...rules.conflicts.map(
                c =>
                  `- ${c.point} (${c.records.map(n => `ADR ${pad(n)}`).join(', ')})`
              ),
            ]),
        '',
        `Suggested by ${rules.model} (${rules.promptVersion}), checked by the guard of Compadr, and validated with compadr rules from commit ${commit.slice(0, 8)}. compadr check says when a record of the chain changes.`,
      ].join('\n'),
    files: new Map([
      [glossaryPath, writeValidatedRules(glossary, featureId, rules)],
    ]),
  }
}
