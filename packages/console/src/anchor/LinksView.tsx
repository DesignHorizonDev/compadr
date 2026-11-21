import { useMemo, useState } from 'react'
import type { DriftReport } from '@compadr/format'
import { decisionLabel } from '../drift/signals.ts'
import { count, shortCommit } from '../format.ts'
import { AnchorProposal } from './AnchorProposal.tsx'
import { linksToRepair, symbolLength } from './proposals.ts'

const numbers = new Intl.NumberFormat('en-US')

/** The links that still rely on a line number, and their proposed anchors. */
export function LinksView({ report }: { report: DriftReport }) {
  const rows = useMemo(() => linksToRepair(report), [report])
  const [selectedId, setSelectedId] = useState<string>()
  const selected = rows.find(row => row.reference.id === selectedId)
  const proposed = rows.filter(row => row.proposal !== null).length
  const titles = useMemo(
    () => new Map(report.decisions.map(d => [d.number, d.title])),
    [report]
  )

  return (
    <div className="drift">
      <div className="drift-main">
        <p className="content-note">
          {report.repository.ref} at commit{' '}
          {shortCommit(report.repository.commit)} ·{' '}
          {numbers.format(rows.length)}{' '}
          {rows.length === 1 ? 'link cites' : 'links cite'} a line number ·{' '}
          {numbers.format(proposed)} can be anchored on a symbol
        </p>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <p className="empty">No link relies on a line number.</p>
          ) : (
            <table className="signals links">
              <thead>
                <tr>
                  <th scope="col">Cited</th>
                  <th scope="col">Proposed anchor</th>
                  <th scope="col">Symbol</th>
                  <th scope="col">Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ reference, proposal }) => (
                  <tr
                    key={reference.id}
                    className={
                      reference.id === selectedId ? 'selected' : undefined
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className="signal-title"
                        aria-pressed={reference.id === selectedId}
                        onClick={() => setSelectedId(reference.id)}
                      >
                        <code>{reference.text}</code>
                      </button>
                    </td>
                    <td>
                      {proposal ? (
                        <code>{proposal.symbol}</code>
                      ) : (
                        <span className="muted">No proposal</span>
                      )}
                    </td>
                    <td className="muted">
                      {proposal ? count(symbolLength(proposal), 'line') : '–'}
                    </td>
                    <td>
                      <code>{decisionLabel(reference.decision)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {selected && (
        <aside className="detail" aria-label="Link detail">
          <div className="detail-head">
            <p className="detail-kicker">Link to repair</p>
            <button
              type="button"
              className="close"
              onClick={() => setSelectedId(undefined)}
            >
              Close
            </button>
          </div>
          <h2 className="detail-title">
            <code>{selected.reference.text}</code>
          </h2>
          <dl className="facts">
            <dt>Decision</dt>
            <dd>
              {decisionLabel(selected.reference.decision)}
              {titles.has(selected.reference.decision) &&
                ` · ${titles.get(selected.reference.decision)}`}
            </dd>
            <dt>In the record</dt>
            <dd>line {selected.reference.adrLine}</dd>
          </dl>
          <AnchorProposal
            key={selected.reference.id}
            report={report}
            reference={selected.reference}
          />
        </aside>
      )}
    </div>
  )
}
