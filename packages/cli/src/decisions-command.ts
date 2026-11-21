// `compadr decisions`: the decisions that apply to a file, as text.
import type { DriftReport, FileDecision, FileDecisions } from '@compadr/format'

const label = (n: number) => `ADR-${String(n).padStart(4, '0')}`

function lines(span: { start: number; end: number } | null): string {
  if (span === null) return ''
  return span.start === span.end
    ? ` (line ${span.start})`
    : ` (lines ${span.start}-${span.end})`
}

/** One line per kind of link: what the record cites, where the file cites it. */
function describe(entry: FileDecision, path: string): string[] {
  const counts = new Map<string, number>()
  for (const link of entry.links) {
    if (link.source === 'record-cites-symbol') {
      const date = link.citedAt ? `, cited ${link.citedAt.slice(0, 10)}` : ''
      const by =
        link.decision === entry.decision ? '' : ` (in ${label(link.decision)})`
      const line = `the record cites the symbol ${link.symbol}, declared here on line ${link.line}${date}${by}`
      counts.set(line, (counts.get(line) ?? 0) + 1)
      continue
    }
    if (link.source !== 'record-cites-path') continue
    const what =
      link.symbol !== null
        ? `the symbol ${link.symbol} of this file`
        : link.path === path
          ? `this file${lines(link.lines)}`
          : `the folder ${link.path}`
    const date = link.citedAt ? `, cited ${link.citedAt.slice(0, 10)}` : ''
    const by =
      link.decision === entry.decision ? '' : ` (in ${label(link.decision)})`
    const line = `the record cites ${what}${date}${by}`
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  const out = [...counts].map(([line, count]) =>
    count === 1 ? line : `${line} (${count} references)`
  )
  // The file may cite a superseded decision that this one replaces.
  const cited = new Map<number, Set<number>>()
  for (const link of entry.links) {
    if (link.source !== 'file-cites-record') continue
    cited.set(
      link.decision,
      (cited.get(link.decision) ?? new Set()).add(link.line)
    )
  }
  for (const [decision, set] of cited) {
    const numbers = [...set].sort((a, b) => a - b)
    const what = decision === entry.decision ? 'it' : label(decision)
    out.push(
      `the file cites ${what} on line${numbers.length === 1 ? '' : 's'} ${numbers.join(', ')}`
    )
  }
  if (entry.replaces.length > 0) {
    out.push(`replaces ${entry.replaces.map(label).join(', ')}`)
  }
  return out
}

function group(title: string, entries: FileDecision[], path: string): string[] {
  if (entries.length === 0) return []
  const block = (list: FileDecision[]) =>
    list.flatMap(entry => [
      `  ${label(entry.decision)}  ${entry.title}`,
      ...describe(entry, path).map(line => `      ${line}`),
    ])
  const folder = entries.filter(entry => entry.scope === 'folder')
  return [
    '',
    title,
    ...block(entries.filter(entry => entry.scope === 'file')),
    ...(folder.length > 0
      ? ['  Through a cited folder only:', ...block(folder)]
      : []),
  ]
}

/** The answer of `compadr decisions`, as text. */
export function formatFileDecisions(
  report: DriftReport,
  answer: FileDecisions
): string {
  const head = `${answer.path} at ${report.repository.ref} (${report.repository.commit.slice(0, 8)})`
  const body = [
    ...group('In force', answer.inForce, answer.path),
    ...group('Context, not binding', answer.context, answer.path),
    ...group('No longer in force', answer.outOfForce, answer.path),
  ]
  return body.length === 0
    ? `${head}\n\nNo decision is linked to this file.`
    : [head, ...body].join('\n')
}
