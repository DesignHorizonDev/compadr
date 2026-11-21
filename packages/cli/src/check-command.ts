// `compadr check`: the problems that fail a pipeline, as text or as GitHub
// workflow commands.
import type { CheckProblem } from '@compadr/engine'
import type { DriftReport } from '@compadr/format'
import type { checkChange } from '@compadr/engine'
import { oneLine, type SemanticCheck } from '@compadr/assist'

export const CHECK_FORMATS = ['text', 'github'] as const
export type CheckFormat = (typeof CHECK_FORMATS)[number]

function place(problem: CheckProblem): string {
  return problem.line === null
    ? problem.file
    : `${problem.file}:${problem.line}`
}

// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
const escapeData = (text: string) =>
  text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = (text: string) =>
  escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C')

function annotation(
  problem: CheckProblem,
  command: 'error' | 'warning'
): string {
  const properties = [
    `file=${escapeProperty(problem.file)}`,
    ...(problem.line === null ? [] : [`line=${problem.line}`]),
    `title=${escapeProperty(`compadr ${problem.rule}`)}`,
  ]
  return `::${command} ${properties.join(',')}::${escapeData(problem.message)}`
}

function formatProblem(
  problem: CheckProblem,
  format: CheckFormat,
  command: 'error' | 'warning'
): string {
  if (format === 'github') return annotation(problem, command)
  // A warning says so on its line: only the errors fail the check.
  const severity = command === 'warning' ? '  warning' : ''
  return `${place(problem)}${severity}  ${problem.rule}  ${problem.message}`
}

/**
 * Lines of the answer: one per problem, one per notice, then a summary. Only
 * the problems fail the check.
 */
export function formatCheck(
  problems: readonly CheckProblem[],
  context: {
    format: CheckFormat
    total: number
    base: string | null
    notices?: readonly CheckProblem[]
  }
): string[] {
  const notices = context.notices ?? []
  const lines = [
    ...problems.map(problem => formatProblem(problem, context.format, 'error')),
    ...notices.map(notice => formatProblem(notice, context.format, 'warning')),
  ]
  const known = context.total - problems.length
  const since = context.base === null ? '' : ` since ${context.base}`
  const asides = [
    ...(context.base !== null && known > 0
      ? [`${known} already in ${context.base}, not counted`]
      : []),
    ...(notices.length > 0
      ? [`${notices.length} notice${notices.length === 1 ? '' : 's'}`]
      : []),
  ]
  const aside = asides.length === 0 ? '' : ` (${asides.join('; ')})`
  lines.push(
    problems.length === 0
      ? `✔ No ${context.base === null ? '' : 'new '}problem${since}${aside}`
      : `✖ ${problems.length} problem${problems.length === 1 ? '' : 's'}${since}${aside}`
  )
  return lines
}

const pad = (n: number) => String(n).padStart(4, '0')

export type ChangeCheck = ReturnType<typeof checkChange>

/**
 * The signals of a change as problems: the broken ones fail the check, and
 * the cited lines that the change modifies are only to review.
 */
export function changeProblems(
  report: DriftReport,
  change: ChangeCheck
): { problems: CheckProblem[]; reviews: CheckProblem[] } {
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  const references = new Map(report.references.map(r => [r.id, r]))
  const problems: CheckProblem[] = []
  const reviews: CheckProblem[] = []
  for (const signal of change.signals) {
    const adr = `ADR ${pad(signal.decision)}`
    const key = `${signal.type}:${pad(signal.decision)}:${signal.path}`
    if (signal.type === 'cited-path-removed') {
      const moved =
        signal.renamedTo === null
          ? 'which the change removes'
          : `which the change moves to \`${signal.renamedTo}\``
      problems.push({
        rule: signal.type,
        decision: signal.decision,
        file: decisions.get(signal.decision)?.file ?? '',
        line: references.get(signal.reference)?.adrLine ?? null,
        message: `${adr} cites \`${signal.text}\`, ${moved}`,
        key,
      })
    } else if (signal.type === 'cited-lines-changed') {
      reviews.push({
        rule: signal.type,
        decision: signal.decision,
        file: decisions.get(signal.decision)?.file ?? '',
        line: references.get(signal.reference)?.adrLine ?? null,
        message: `${adr} cites \`${signal.text}\`, whose lines the change modifies: reread the decision`,
        key,
      })
    } else {
      problems.push({
        rule: signal.type,
        decision: signal.decision,
        file: signal.path,
        line: signal.line,
        message:
          signal.type === 'unknown-decision-cited'
            ? `The change cites ${adr}, which does not exist`
            : `The change cites ${adr}, superseded by ${signal.supersededBy.map(n => `ADR ${pad(n)}`).join(', ') || 'another decision'}`,
        key,
      })
    }
  }
  return { problems, reviews }
}

/**
 * Lines of the answer for a change: the problems, the cited lines to review,
 * then a summary. Only the problems fail the check.
 */
export function formatChangeCheck(
  checked: { problems: CheckProblem[]; reviews: CheckProblem[] },
  context: { format: CheckFormat; files: number }
): string[] {
  const { problems, reviews } = checked
  const lines = [
    ...problems.map(problem => formatProblem(problem, context.format, 'error')),
    ...reviews.map(review => formatProblem(review, context.format, 'warning')),
  ]
  const files = `${context.files} changed file${context.files === 1 ? '' : 's'}`
  const aside =
    reviews.length === 0
      ? ''
      : ` (${reviews.length} cited block${reviews.length === 1 ? '' : 's'} to review)`
  lines.push(
    problems.length === 0
      ? `✔ No problem in ${files}${aside}`
      : `✖ ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${files}${aside}`
  )
  return lines
}

/** The findings of the semantic check as notices: they never fail the check. */
export function semanticNotices(check: SemanticCheck): CheckProblem[] {
  if (check.status !== 'done') return []
  return check.findings.map(finding => {
    const adr = `ADR ${pad(finding.decision)}`
    const verdict =
      finding.verdict === 'violated' ? 'may be broken' : 'may be weakened'
    const unverified =
      finding.notices.length === 0
        ? ''
        : ` (not verified: ${finding.notices.join('; ')})`
    return {
      rule: `semantic-${finding.verdict}`,
      decision: finding.decision,
      file: finding.evidence.path,
      line: finding.line,
      // A text of the model stays on the line of its notice.
      message: oneLine(
        `${adr} (${finding.title}) ${verdict}: "${finding.quote}". ${finding.explanation}${unverified}`
      ),
      key: `semantic-${finding.verdict}:${pad(finding.decision)}:${finding.evidence.path}`,
    }
  })
}

/** Lines of the answer for the semantic check, after those of the check. */
export function formatSemanticCheck(
  check: SemanticCheck,
  format: CheckFormat
): string[] {
  if (check.status === 'skipped') {
    return [`◇ Semantic check skipped: ${oneLine(check.reason)}`]
  }
  if (check.status === 'failed') {
    return [
      `◇ Semantic check failed, the result above stands: ${oneLine(check.reason)}`,
    ]
  }
  const notices = semanticNotices(check)
  const count = `${notices.length} possible break${notices.length === 1 ? '' : 's'}`
  const asides = [
    `${check.model}, ${check.promptVersion}`,
    ...(check.rejected > 0 ? [`${check.rejected} removed by the guard`] : []),
    ...(check.excluded.length > 0
      ? [`${check.excluded.length} file(s) kept out by compadr.yml`]
      : []),
  ]
  return [
    ...notices.map(notice => formatProblem(notice, format, 'warning')),
    `◇ Semantic check: ${notices.length === 0 ? 'no possible break' : count} (${asides.join('; ')}). A model suggests; it never fails the check.`,
  ]
}

/** Marks the comment of Compadr, so that a workflow edits it instead of adding one. */
export const SEMANTIC_COMMENT_MARKER = '<!-- compadr:semantic-check -->'

// Text of a model or of a record, in Markdown: no HTML, no link or image,
// and no mention that would notify someone. A code span stays as it is:
// Markdown shows it word for word, so nothing in it is active.
const escapeProse = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;')
    .replace(/[[\]()!\\]/g, '\\$&')

const CODE_SPAN = /(`+)[^`\n][\s\S]*?\1(?!`)/g

function plain(text: string): string {
  let result = ''
  let last = 0
  for (const match of text.matchAll(CODE_SPAN)) {
    result += escapeProse(text.slice(last, match.index)) + match[0]
    last = match.index + match[0].length
  }
  return result + escapeProse(text.slice(last))
}

function fenced(text: string, language: string): string {
  const longest = Math.max(
    2,
    ...[...text.matchAll(/`+/g)].map(match => match[0].length)
  )
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${text.replace(/\n+$/, '')}\n${fence}`
}

/**
 * The comment of a pull request for the semantic check, in Markdown; null
 * when nothing was sent, so that a repository without the option gets no
 * comment. At the cap of the AI credits, the comment says that the check did
 * not run.
 */
export function semanticComment(check: SemanticCheck): string | null {
  const heading = `${SEMANTIC_COMMENT_MARKER}\n### Compadr: semantic check`
  // At the cap, the team learns why the check did not run this time.
  if (check.status === 'skipped' && check.capped === true) {
    return `${heading}\n\nThe semantic check did not run: ${plain(check.reason).replace(/\.+$/, '')}. The result of \`compadr check\` stands.\n`
  }
  if (check.status === 'skipped') return null
  if (check.status === 'failed') {
    return `${heading}\n\nThe semantic check could not run: ${plain(check.reason)}. The result of \`compadr check\` stands.\n`
  }
  const footer = `_A suggestion of ${plain(check.model)} (${plain(check.promptVersion)}), checked by the guard of Compadr. It never fails the check: a person decides.${check.excluded.length > 0 ? ` ${check.excluded.length} changed file(s) stayed out, as compadr.yml asks.` : ''}_`
  if (check.findings.length === 0) {
    return `${heading}\n\nThe assist service found no break of a decision in force in this change.\n\n${footer}\n`
  }
  const findings = check.findings.map(finding => {
    const verdict = finding.verdict === 'violated' ? 'violated' : 'at risk'
    const place =
      finding.line === null
        ? `\`${finding.evidence.path}\``
        : `\`${finding.evidence.path}\`, line ${finding.line}`
    const quote = plain(finding.quote)
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')
    return [
      `#### ADR ${pad(finding.decision)} · ${plain(finding.title)} (${verdict})`,
      '',
      quote,
      '',
      ...(finding.evidence.text.trim() === ''
        ? [place]
        : [`${place}:`, '', fenced(finding.evidence.text, 'diff')]),
      '',
      plain(finding.explanation),
      ...(finding.notices.length === 0
        ? []
        : [
            '',
            `_Not verified by the guard: ${plain(finding.notices.join('; '))}_`,
          ]),
    ].join('\n')
  })
  const count =
    check.findings.length === 1
      ? 'one possible break of a decision in force'
      : `${check.findings.length} possible breaks of decisions in force`
  return `${heading}\n\nThe assist service found ${count}.\n\n${findings.join('\n\n')}\n\n${footer}\n`
}
