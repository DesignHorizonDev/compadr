import { useId, useMemo, useState } from 'react'
import type { DriftReport } from '@compadr/format'
import type { ReportSource } from '../reports.ts'
import {
  anchoredShare,
  anchoring,
  countSignals,
  decisionLabel,
  driftRows,
  formatDate,
  indexReport,
  LEVELS,
  summarizeLevels,
  type DriftLevel,
  type SignalRow,
} from './signals.ts'
import { shortCommit } from '../format.ts'
import { FindingsSection } from './FindingsSection.tsx'
import { SignalDetail } from './SignalDetail.tsx'

type Tab = DriftLevel | 'all'

const TABS: { tab: Tab; label: string }[] = [
  { tab: 'all', label: 'All' },
  { tab: 'broken', label: LEVELS.broken.label },
  { tab: 'review', label: LEVELS.review.label },
  { tab: 'order', label: LEVELS.order.label },
]

const numbers = new Intl.NumberFormat('en-US')

export function LevelBadge({ level }: { level: DriftLevel }) {
  return (
    <span className={`badge badge-${level}`}>
      <span aria-hidden="true">{LEVELS[level].symbol}</span>{' '}
      {LEVELS[level].label}
    </span>
  )
}

/**
 * Drift of one report: indicators, signals by level, and their detail, then
 * the findings of a semantic check when the server keeps some.
 */
export function DriftView({
  report,
  findingsOf,
}: {
  report: DriftReport
  /** Where to read the findings of the report; absent when the source has none. */
  findingsOf?: { source: ReportSource; id: string }
}) {
  const index = useMemo(() => indexReport(report), [report])
  const rows = useMemo(() => driftRows(index), [index])
  const levels = summarizeLevels(rows)
  const links = anchoring(report)
  const citationsInCode = report.citations.filter(c => c.inCode).length
  // Only certain drift alerts, so the view opens on it.
  const [tab, setTab] = useState<Tab>('broken')
  const [selectedId, setSelectedId] = useState<string>()
  const panelId = useId()

  const visible =
    tab === 'all' ? rows : rows.filter(row => row.signal.level === tab)
  // A signal outside the open tab has no detail: the table does not show it.
  const selected = visible.find(row => row.signal.id === selectedId)
  const count = (tab: Tab) =>
    tab === 'all'
      ? rows.length
      : (levels.find(summary => summary.level === tab)?.count ?? 0)

  return (
    <div className="drift">
      <div className="drift-main">
        <p className="content-note">
          {report.repository.ref} at commit{' '}
          {shortCommit(report.repository.commit)} · scanned{' '}
          {formatDate(report.generatedAt)} ·{' '}
          {numbers.format(report.decisions.length)} decisions ·{' '}
          {numbers.format(links.paths)} path links ·{' '}
          {numbers.format(citationsInCode)} citations in code
        </p>

        <section className="kpis" aria-label="Indicators">
          {levels.map(summary => (
            <div key={summary.level} className="kpi">
              <p className="kpi-label">
                <LevelBadge level={summary.level} />
              </p>
              <p className="kpi-value">{numbers.format(summary.count)}</p>
              <p className="kpi-detail">
                {summary.types.length > 0
                  ? summary.types
                      .map(({ type, count }) => countSignals(type, count))
                      .join(' · ')
                  : 'Nothing at this level'}
              </p>
            </div>
          ))}
          <div className="kpi">
            <p className="kpi-label">Anchored on symbols</p>
            <p className="kpi-value">{anchoredShare(links)}</p>
            <p className="kpi-detail">
              {numbers.format(links.anchored)} of {numbers.format(links.paths)}{' '}
              path links. The others rely on a path or a line number.
            </p>
          </div>
        </section>

        <div className="tabs" role="tablist" aria-label="Signal levels">
          {TABS.map(({ tab: candidate, label }) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              className="tab"
              aria-selected={candidate === tab}
              aria-controls={panelId}
              onClick={() => setTab(candidate)}
            >
              {label} <span className="tab-count">{count(candidate)}</span>
            </button>
          ))}
        </div>
        {tab !== 'all' && <p className="tab-hint">{LEVELS[tab].hint}</p>}

        <div id={panelId} role="tabpanel" className="table-wrap">
          {visible.length === 0 ? (
            <p className="empty">No signal at this level.</p>
          ) : (
            <table className="signals">
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">Signal</th>
                  <th scope="col">Area</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Cited</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => (
                  <SignalLine
                    key={row.signal.id}
                    row={row}
                    selected={row.signal.id === selectedId}
                    onSelect={() => setSelectedId(row.signal.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
        {findingsOf && (
          <FindingsSection
            report={report}
            source={findingsOf.source}
            id={findingsOf.id}
          />
        )}
      </div>
      {selected && (
        <SignalDetail
          row={selected}
          index={index}
          onClose={() => setSelectedId(undefined)}
        />
      )}
    </div>
  )
}

function SignalLine({
  row,
  selected,
  onSelect,
}: {
  row: SignalRow
  selected: boolean
  onSelect: () => void
}) {
  return (
    <tr className={selected ? 'selected' : undefined}>
      <td>
        <LevelBadge level={row.signal.level} />
      </td>
      <td>
        <button
          type="button"
          className="signal-title"
          aria-pressed={selected}
          onClick={onSelect}
        >
          {row.title}
        </button>
        <p className="signal-target">
          <code>{row.target}</code>
          {row.note && <span className="muted"> · {row.note}</span>}
        </p>
      </td>
      <td className="area">{row.area ?? '–'}</td>
      <td>
        <code>{decisionLabel(row.signal.decision)}</code>
      </td>
      <td className="muted">{row.citedAt ? formatDate(row.citedAt) : '–'}</td>
    </tr>
  )
}
