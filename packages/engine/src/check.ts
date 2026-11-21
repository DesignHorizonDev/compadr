import {
  COMPADR_CONFIG,
  DEFAULT_RULE_POLICY,
  isWeakRule,
  type CodeReference,
  type Decision,
  type DriftReport,
  FEATURE_GLOSSARY,
  proposedApplied,
} from '@compadr/format'
import {
  AGENTS_FILES,
  findAgentsExcerpt,
  INDEX_FILE,
  INDEX_MARKER,
  MAP_FILE,
  MAP_MARKER,
  renderAgentsExcerpt,
  renderIndex,
  renderMemoryCard,
} from './generated.ts'

/**
 * Rules that `compadr check` applies on top of the broken signals. Each one
 * is certain: a team can fail a pipeline on it without a human first sorting
 * the false positives out.
 */
export const CHECK_RULES = [
  'status-unknown',
  'superseded-without-successor',
  'successor-missing',
  'decision-without-feature',
  'feature-declaration',
  'generated-file-stale',
  'rule-missing',
  'config-invalid',
] as const

export type CheckRule = (typeof CHECK_RULES)[number]

/**
 * Notices that `compadr check` prints without failing: what a team may want
 * to improve, under the rule policy of `compadr.yml`.
 */
export const CHECK_NOTICES = [
  'rule-missing',
  'rule-weak',
  'record-too-long',
  'decision-text-too-long',
  'consolidated-rule-stale',
  'proposed-applied',
] as const

/** A record longer than this, in lines, mixes the decision with other text. */
export const MAX_RECORD_LINES = 400

/**
 * A Decision section longer than this, in characters (about 3 400 tokens),
 * costs an agent much to read: split it or move the inventory out.
 */
export const MAX_DECISION_CHARACTERS = 12_000

export type CheckNotice = (typeof CHECK_NOTICES)[number]

/** A problem that fails the check, with the place to show it at. */
export interface CheckProblem {
  /** Type of the broken signal, or rule of the check. */
  rule: string
  /** Decision concerned, when there is one. */
  decision: number | null
  /** File to show the problem on: the record, or the file of the code. */
  file: string
  line: number | null
  message: string
  /**
   * What identifies the problem across commits. Line numbers move when a
   * record or a file is edited, so the key leaves them out.
   */
  key: string
}

const pad = (n: number) => String(n).padStart(4, '0')

function referenceProblem(
  rule: string,
  reference: CodeReference,
  decision: Decision | undefined,
  message: string
): CheckProblem {
  return {
    rule,
    decision: reference.decision,
    file: decision?.file ?? '',
    line: reference.adrLine,
    message,
    key: `${rule}:${pad(reference.decision)}:${reference.text}`,
  }
}

function signalProblems(
  report: DriftReport,
  decisions: ReadonlyMap<number, Decision>
): CheckProblem[] {
  const references = new Map(report.references.map(r => [r.id, r]))
  const problems: CheckProblem[] = []
  for (const signal of report.signals) {
    if (signal.level !== 'broken') continue
    const decision = decisions.get(signal.decision)
    const adr = `ADR ${pad(signal.decision)}`
    switch (signal.type) {
      case 'path-missing':
      case 'cited-line-out-of-range':
      case 'anchor-symbol-missing': {
        const reference = references.get(signal.reference)
        if (reference === undefined) break
        const message =
          signal.type === 'path-missing'
            ? `${adr} cites \`${reference.text}\`, which no longer exists`
            : signal.type === 'cited-line-out-of-range'
              ? `${adr} cites \`${reference.text}\`, beyond the end of the file (${signal.fileLineCount} lines)`
              : `${adr} is anchored on \`${reference.text}\`, whose symbol no longer exists`
        problems.push(
          referenceProblem(signal.type, reference, decision, message)
        )
        break
      }
      case 'superseded-decision-cited':
        problems.push({
          rule: signal.type,
          decision: signal.decision,
          file: signal.file,
          line: signal.line,
          message: `This file cites ${adr}, superseded by ${signal.supersededBy.map(n => `ADR ${pad(n)}`).join(', ')}`,
          key: `${signal.type}:${pad(signal.decision)}:${signal.file}`,
        })
        break
      case 'unknown-decision-cited':
        problems.push({
          rule: signal.type,
          decision: signal.decision,
          file: signal.file,
          line: signal.line,
          message: `This file cites ${adr}, which does not exist`,
          key: `${signal.type}:${pad(signal.decision)}:${signal.file}`,
        })
        break
      case 'index-status-mismatch':
        problems.push({
          rule: signal.type,
          decision: signal.decision,
          file: decision?.file ?? '',
          line: null,
          message: `${adr} is "${signal.recordStatus}" in its record and "${signal.indexStatus}" in the index`,
          key: `${signal.type}:${pad(signal.decision)}`,
        })
        break
    }
  }
  return problems
}

function decisionProblem(
  rule: CheckRule | CheckNotice,
  decision: Decision,
  message: string
): CheckProblem {
  return {
    rule,
    decision: decision.number,
    file: decision.file,
    line: null,
    message,
    key: `${rule}:${pad(decision.number)}`,
  }
}

function ruleProblems(
  report: DriftReport,
  decisions: ReadonlyMap<number, Decision>
): CheckProblem[] {
  const problems: CheckProblem[] = []
  const declared = (report.features ?? []).filter(f => f.source === 'declared')
  const grouped = new Set(declared.flatMap(feature => feature.decisions))
  for (const decision of report.decisions) {
    const adr = `ADR ${pad(decision.number)}`
    if (decision.status === 'unknown') {
      problems.push(
        decisionProblem(
          'status-unknown',
          decision,
          `${adr} has a status that Compadr cannot read: "${decision.rawStatus}"`
        )
      )
    }
    if (
      decision.status === 'superseded' &&
      decision.supersededBy.length === 0
    ) {
      problems.push(
        decisionProblem(
          'superseded-without-successor',
          decision,
          `${adr} is superseded but does not name the decision that replaces it`
        )
      )
    }
    for (const successor of decision.supersededBy) {
      if (!decisions.has(successor)) {
        problems.push({
          ...decisionProblem(
            'successor-missing',
            decision,
            `${adr} is superseded by ADR ${pad(successor)}, which is not in ${report.repository.adrDir}`
          ),
          key: `successor-missing:${pad(decision.number)}:${pad(successor)}`,
        })
      }
    }
    if (declared.length > 0 && !grouped.has(decision.number)) {
      problems.push(
        decisionProblem(
          'decision-without-feature',
          decision,
          `${adr} belongs to no feature: add compadr.feature to its record`
        )
      )
    }
  }
  for (const problem of report.featureProblems ?? []) {
    // A problem of a record names it: `ADR 0007: compadr.feature …`. The
    // others concern the glossary.
    const number = /^ADR (\d+):/.exec(problem)?.[1]
    const decision = number === undefined ? undefined : decisions.get(+number)
    problems.push({
      rule: 'feature-declaration',
      decision: decision?.number ?? null,
      file: decision?.file ?? `${report.repository.adrDir}/features.yml`,
      line: null,
      message: problem,
      // A YAML error gives its position, which moves with any edit above it.
      key: `feature-declaration:${problem.replace(/\b(?:line|column|col) \d+|\d+:\d+/gi, '#')}`,
    })
  }
  for (const problem of report.configProblems ?? []) {
    problems.push({
      rule: 'config-invalid',
      decision: null,
      file: `${report.repository.adrDir}/${COMPADR_CONFIG}`,
      line: null,
      message: problem,
      key: `config-invalid:${problem.replace(/\b(?:line|column|col) \d+|\d+:\d+/gi, '#')}`,
    })
  }
  if (report.rulePolicy === 'required') {
    for (const decision of report.decisions) {
      if (decision.status !== 'accepted') continue
      if (decision.rule?.source === 'declared') continue
      problems.push(
        decisionProblem(
          'rule-missing',
          decision,
          `ADR ${pad(decision.number)} declares no rule: add compadr.rule to its record (rules.policy is required)`
        )
      )
    }
  }
  return problems
}

/**
 * Notices of `compadr check`, which do not fail it: a decision in force whose
 * record or Decision section is too long for an agent, whatever the rule
 * policy. Under the policy `preferred`, a decision in force without a rule
 * that stands alone, and a declared rule too short to stand alone. Under
 * `required`, the weak declared rules only; under `derived`, no notice on
 * the rules.
 */
export function checkNotices(report: DriftReport): CheckProblem[] {
  const policy = report.rulePolicy ?? DEFAULT_RULE_POLICY
  const notices: CheckProblem[] = []
  for (const decision of report.decisions) {
    if (decision.status !== 'accepted') continue
    const adr = `ADR ${pad(decision.number)}`
    // The length of a record matters whatever the rule policy.
    if (decision.lineCount > MAX_RECORD_LINES) {
      notices.push(
        decisionProblem(
          'record-too-long',
          decision,
          `${adr} has ${decision.lineCount} lines: keep the decision and its reasons, and move inventories of files and lines out of the record`
        )
      )
    }
    const characters = (decision.text?.sections ?? []).reduce(
      (sum, section) => sum + section.markdown.length,
      0
    )
    if (characters > MAX_DECISION_CHARACTERS) {
      notices.push(
        decisionProblem(
          'decision-text-too-long',
          decision,
          `${adr} has a Decision section of ${characters} characters: an agent reads it whole, so give one rule per subsection and split a decision that covers several features`
        )
      )
    }
    if (policy === 'derived') continue
    const rule = decision.rule ?? null
    if (rule?.source === 'declared' && isWeakRule(rule.text)) {
      notices.push(
        decisionProblem(
          'rule-weak',
          decision,
          `${adr} declares a rule too short to stand alone: say in compadr.rule what the decision requires`
        )
      )
    } else if (rule === null && policy === 'preferred') {
      notices.push(
        decisionProblem(
          'rule-missing',
          decision,
          `${adr} has no rule that an agent can read alone: add compadr.rule to its record`
        )
      )
    }
  }
  // Proposed decisions that the code cites: a person may have forgotten to
  // accept them.
  for (const { decision, files } of proposedApplied(report)) {
    const adr = `ADR ${pad(decision.number)}`
    notices.push(
      decisionProblem(
        'proposed-applied',
        decision,
        `${adr} is proposed, and ${files.length === 1 ? '1 file of the code cites' : `${files.length} files of the code cite`} it: if the code applies the decision, accept it, or say in the record why it waits`
      )
    )
  }
  // Validated rules whose chain changed: a person consolidates them again.
  for (const feature of report.features ?? []) {
    const stale = feature.staleRecords ?? []
    if (feature.rules === undefined || stale.length === 0) continue
    notices.push({
      rule: 'consolidated-rule-stale',
      decision: feature.rules.decision,
      file: `${report.repository.adrDir}/${FEATURE_GLOSSARY}`,
      line: null,
      message: `The rules in force of ${feature.label} were validated on ${feature.rules.validated}, and ${stale.map(n => `ADR ${pad(n)}`).join(', ')} changed since: consolidate them again (compadr assist consolidate, then compadr rules)`,
      key: `consolidated-rule-stale:${feature.id}`,
    })
  }
  return notices
}

/** Problems that fail `compadr check`, in the order of the report. */
export function checkReport(report: DriftReport): CheckProblem[] {
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  return [
    ...signalProblems(report, decisions),
    ...ruleProblems(report, decisions),
  ]
}

/** Files that `generatedFileProblems` compares, by path in the repository. */
export function generatedFilePaths(report: DriftReport): string[] {
  return [
    `${report.repository.adrDir}/${INDEX_FILE}`,
    `${report.repository.adrDir}/${MAP_FILE}`,
    ...AGENTS_FILES,
  ]
}

/**
 * Generated files that no longer match the records: an index and a memory
 * card that start with the marker of `compadr index` or `compadr map`, and an
 * excerpt between the markers of `compadr agents`. `files` holds the content of each path of
 * `generatedFilePaths` at the analysed commit, when the file exists.
 */
export function generatedFileProblems(
  report: DriftReport,
  files: ReadonlyMap<string, string>
): CheckProblem[] {
  const stale = (file: string, command: string): CheckProblem => ({
    rule: 'generated-file-stale',
    decision: null,
    file,
    line: null,
    message: `${file} no longer matches the decision records: run compadr ${command}`,
    key: `generated-file-stale:${file}`,
  })
  const problems: CheckProblem[] = []
  const [index, map, ...agents] = generatedFilePaths(report)
  const indexContent = files.get(index!)
  if (
    indexContent?.startsWith(INDEX_MARKER) &&
    indexContent.replace(/\r\n/g, '\n') !== renderIndex(report)
  ) {
    problems.push(stale(index!, 'index'))
  }
  const mapContent = files.get(map!)
  if (
    mapContent?.startsWith(MAP_MARKER) &&
    mapContent.replace(/\r\n/g, '\n') !== renderMemoryCard(report)
  ) {
    problems.push(stale(map!, 'map'))
  }
  // Without --file, `compadr agents` writes in the first of these files.
  const written = agents.find(file => files.has(file))
  for (const file of agents) {
    const excerpt = findAgentsExcerpt(
      (files.get(file) ?? '').replace(/\r\n/g, '\n')
    )
    if (
      excerpt !== null &&
      excerpt.trimEnd() !== renderAgentsExcerpt(report).trimEnd()
    ) {
      problems.push(
        stale(file, file === written ? 'agents' : `agents --file ${file}`)
      )
    }
  }
  return problems
}

/**
 * Problems of `head` that `base` does not have. Keys count as a multiset: a
 * second citation of a superseded decision in the same file is new even
 * when the base already had one.
 */
export function newProblems(
  head: readonly CheckProblem[],
  base: readonly CheckProblem[]
): CheckProblem[] {
  const remaining = new Map<string, number>()
  for (const problem of base) {
    remaining.set(problem.key, (remaining.get(problem.key) ?? 0) + 1)
  }
  return head.filter(problem => {
    const count = remaining.get(problem.key) ?? 0
    if (count === 0) return true
    remaining.set(problem.key, count - 1)
    return false
  })
}
