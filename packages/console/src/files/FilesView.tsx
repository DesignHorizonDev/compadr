import { useId, useMemo, useState } from 'react'
import {
  decisionsForFile,
  linkedPaths,
  type DriftReport,
  type FileDecision,
} from '@compadr/format'
import { decisionLabel, formatDate } from '../drift/signals.ts'
import { count, shortCommit } from '../format.ts'

/** Rows shown at once: a search narrows a larger list. */
const SHOWN = 200

/** What each link of a decision says about the file, one line per kind. */
export function describeLinks(entry: FileDecision, path: string): string[] {
  const counts = new Map<string, number>()
  for (const link of entry.links) {
    if (link.source === 'record-cites-symbol') {
      const date = link.citedAt ? `, cited ${formatDate(link.citedAt)}` : ''
      const by =
        link.decision === entry.decision
          ? ''
          : ` (in ${decisionLabel(link.decision)})`
      const line = `The record cites the symbol ${link.symbol}, declared in this file on line ${link.line}${date}${by}.`
      counts.set(line, (counts.get(line) ?? 0) + 1)
      continue
    }
    if (link.source !== 'record-cites-path') continue
    const span = link.lines
    const what =
      link.symbol !== null
        ? `the symbol ${link.symbol} of this file`
        : link.path === path
          ? span === null
            ? 'this file'
            : span.start === span.end
              ? `this file (line ${span.start})`
              : `this file (lines ${span.start}–${span.end})`
          : `the folder ${link.path}`
    const date = link.citedAt ? `, cited ${formatDate(link.citedAt)}` : ''
    const by =
      link.decision === entry.decision
        ? ''
        : ` (in ${decisionLabel(link.decision)})`
    const line = `The record cites ${what}${date}${by}.`
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  const out = [...counts].map(([line, n]) =>
    n === 1 ? line : `${line.slice(0, -1)} (${n} references).`
  )
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
    const what = decision === entry.decision ? 'it' : decisionLabel(decision)
    out.push(
      `The file cites ${what} on line${numbers.length === 1 ? '' : 's'} ${numbers.join(', ')}.`
    )
  }
  if (entry.replaces.length > 0) {
    out.push(`Replaces ${entry.replaces.map(decisionLabel).join(', ')}.`)
  }
  return out
}

/** The files linked to a decision, and the decisions of the file selected. */
export function FilesView({
  report,
  onOpenDecision,
  initialPath,
}: {
  report: DriftReport
  onOpenDecision: (number: number) => void
  /** File whose decisions show first, as another view opens it. */
  initialPath?: string
}) {
  const paths = useMemo(() => linkedPaths(report), [report])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | undefined>(initialPath)
  const searchId = useId()
  const matching = paths.filter(entry =>
    entry.path.toLowerCase().includes(query.trim().toLowerCase())
  )
  const answer = useMemo(
    () =>
      selected === undefined ? undefined : decisionsForFile(report, selected),
    [report, selected]
  )

  return (
    <div className="drift">
      <div className="drift-main">
        <p className="content-note">
          {report.repository.ref} at commit{' '}
          {shortCommit(report.repository.commit)} ·{' '}
          {count(paths.length, 'path')} linked to a decision
        </p>
        <label className="visually-hidden" htmlFor={searchId}>
          Search the files
        </label>
        <input
          id={searchId}
          className="search"
          type="search"
          placeholder="Search a file or a folder"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        {matching.length === 0 ? (
          <p className="empty">No linked file matches the search.</p>
        ) : (
          <ul className="path-list">
            {matching.slice(0, SHOWN).map(entry => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="signal-title"
                  aria-pressed={entry.path === selected}
                  onClick={() => setSelected(entry.path)}
                >
                  <code>{entry.path}</code>
                </button>{' '}
                <span className="muted">
                  {count(entry.decisions, 'decision')} linked directly
                </span>
              </li>
            ))}
          </ul>
        )}
        {matching.length > SHOWN && (
          <p className="hint">
            {SHOWN} of {matching.length} paths are shown. Narrow the search to
            see the others.
          </p>
        )}
      </div>
      {answer && (
        <aside className="detail" aria-label="Decisions of the file">
          <div className="detail-head">
            <p className="detail-kicker">Decisions of the file</p>
            <button
              type="button"
              className="close"
              onClick={() => setSelected(undefined)}
            >
              Close
            </button>
          </div>
          <h2 className="detail-title">
            <code>{answer.path}</code>
          </h2>
          <Group
            title="In force"
            entries={answer.inForce}
            path={answer.path}
            onOpen={onOpenDecision}
          />
          <Group
            title="Context, not binding"
            entries={answer.context}
            path={answer.path}
            onOpen={onOpenDecision}
          />
          <Group
            title="No longer in force"
            entries={answer.outOfForce}
            path={answer.path}
            onOpen={onOpenDecision}
          />
        </aside>
      )}
    </div>
  )
}

function Group({
  title,
  entries,
  path,
  onOpen,
}: {
  title: string
  entries: FileDecision[]
  path: string
  onOpen: (number: number) => void
}) {
  if (entries.length === 0) return null
  const direct = entries.filter(entry => entry.scope === 'file')
  const folder = entries.filter(entry => entry.scope === 'folder')
  const list = (items: FileDecision[]) => (
    <ul className="file-decisions">
      {items.map(entry => (
        <li key={entry.decision}>
          <button
            type="button"
            className="signal-title"
            onClick={() => onOpen(entry.decision)}
          >
            <code>{decisionLabel(entry.decision)}</code> {entry.title}
          </button>
          {describeLinks(entry, path).map(line => (
            <p key={line} className="hint">
              {line}
            </p>
          ))}
        </li>
      ))}
    </ul>
  )
  return (
    <section aria-label={title}>
      <h3 className="proposal-title">
        {title} <span className="tab-count">{entries.length}</span>
      </h3>
      {list(direct)}
      {folder.length > 0 && (
        <>
          <p className="proposal-label">Through a cited folder only</p>
          {list(folder)}
        </>
      )}
    </section>
  )
}
