import type { ReactNode } from 'react'
import { AnchorProposal } from '../anchor/AnchorProposal.tsx'
import { count } from '../format.ts'
import {
  decisionLabel,
  formatDate,
  LEVELS,
  type ReportIndex,
  type SignalRow,
} from './signals.ts'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

/** Facts that only some signal types carry. */
function SignalFacts({ row, index }: { row: SignalRow; index: ReportIndex }) {
  const { signal } = row
  switch (signal.type) {
    case 'path-missing':
    case 'cited-line-out-of-range':
    case 'cited-line-changed':
    case 'cited-file-changed':
    case 'anchor-symbol-missing':
    case 'anchor-symbol-ambiguous':
    case 'anchor-content-changed':
    case 'anchor-lines-changed': {
      const reference = index.reference(signal.reference)
      const anchor = reference?.kind === 'path' ? reference.anchor : null
      return (
        <>
          {reference && (
            <Field label="In the record">
              line {reference.adrLine}: <code>{reference.text}</code>
            </Field>
          )}
          {reference?.kind === 'path' && reference.resolvedPaths.length > 0 && (
            <Field label="Resolved to">
              {reference.resolvedPaths.map(path => (
                <code key={path} className="block">
                  {path}
                </code>
              ))}
            </Field>
          )}
          {reference && reference.citedAt && (
            <Field label="Cited on">{formatDate(reference.citedAt)}</Field>
          )}
          {signal.type === 'cited-line-changed' && (
            <Field label="Line changed on">
              {formatDate(signal.lineChangedAt)}
            </Field>
          )}
          {signal.type === 'cited-file-changed' && (
            <Field label="Commits since">{signal.commitsSince}</Field>
          )}
          {anchor?.fingerprint && (
            <Field label="Recorded fingerprint">
              <code>{anchor.fingerprint}</code>
            </Field>
          )}
          {signal.type === 'anchor-content-changed' && (
            <Field label="Current fingerprint">
              <code>{signal.currentFingerprint}</code>
            </Field>
          )}
          {signal.type === 'anchor-symbol-ambiguous' && (
            <Field label="Matches">{signal.matches}</Field>
          )}
          {signal.type === 'cited-line-out-of-range' && (
            <Field label="File length">
              {count(signal.fileLineCount, 'line')}
            </Field>
          )}
        </>
      )
    }
    case 'linked-files-changed':
      return (
        <>
          <Field label="Oldest citation">
            {formatDate(signal.oldestCitedAt)}
          </Field>
          <Field label="Changed files">
            <ul className="file-list">
              {signal.files.map(file => (
                <li key={file.path}>
                  <code>{file.path}</code>{' '}
                  <span className="muted">
                    {count(file.commitsSince, 'commit')}
                  </span>
                </li>
              ))}
            </ul>
          </Field>
        </>
      )
    case 'superseded-decision-cited':
      return (
        <>
          <Field label="Cited in">
            <code>
              {signal.file}:{signal.line}
            </code>
          </Field>
          <Field label="Replaced by">
            {signal.supersededBy.map(decisionLabel).join(', ')}
          </Field>
        </>
      )
    case 'unknown-decision-cited':
      return (
        <Field label="Cited in">
          <code>
            {signal.file}:{signal.line}
          </code>
        </Field>
      )
    case 'index-status-mismatch':
      return (
        <>
          <Field label="Index says">{signal.indexStatus}</Field>
          <Field label="Record says">{signal.recordStatus}</Field>
        </>
      )
  }
}

export function SignalDetail({
  row,
  index,
  onClose,
}: {
  row: SignalRow
  index: ReportIndex
  onClose: () => void
}) {
  const { signal, decision } = row
  const reference =
    'reference' in signal ? index.reference(signal.reference) : undefined
  return (
    <aside className="detail" aria-label="Signal detail">
      <div className="detail-head">
        <p className="detail-kicker">Signal · {LEVELS[signal.level].label}</p>
        <button type="button" className="close" onClick={onClose}>
          Close
        </button>
      </div>
      <h2 className="detail-title">{row.title}</h2>
      <p>
        <code>{row.target}</code>
      </p>
      <dl className="facts">
        <Field label="Decision">
          {decisionLabel(signal.decision)}
          {decision && ` · ${decision.title}`}
        </Field>
        {decision && <Field label="Status">{decision.rawStatus}</Field>}
        {decision && (
          <Field label="Record">
            <code>{decision.file}</code>
          </Field>
        )}
        {row.area && <Field label="Area">{row.area}</Field>}
        <SignalFacts row={row} index={index} />
      </dl>
      <p className="hint">{LEVELS[signal.level].hint}</p>
      {reference?.kind === 'path' && reference.lines !== null && (
        <AnchorProposal
          key={reference.id}
          report={index.report}
          reference={reference}
        />
      )}
    </aside>
  )
}
