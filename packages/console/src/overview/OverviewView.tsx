import { useEffect, useId, useState } from 'react'
import { LevelBadge } from '../drift/DriftView.tsx'
import { LicenseNote } from '../license/LicenseNote.tsx'
import { UnservedNote } from './UnservedNote.tsx'
import {
  decisionLabel,
  formatDate,
  LEVELS,
  type DriftLevel,
} from '../drift/signals.ts'
import { shortCommit } from '../format.ts'
import type {
  PortalOverview,
  PortalSource,
  QueueRow,
  RepositoryOverview,
} from '../portal.ts'

type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string }

type Tab = DriftLevel | 'all'

const TABS: { tab: Tab; label: string }[] = [
  { tab: 'all', label: 'All' },
  { tab: 'broken', label: LEVELS.broken.label },
  { tab: 'review', label: LEVELS.review.label },
  { tab: 'order', label: LEVELS.order.label },
]

const numbers = new Intl.NumberFormat('en-US')

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface OverviewViewProps {
  overview: PortalOverview
  portal: PortalSource
  /** Opens the Drift view of a repository. */
  onOpenRepository: (reportId: string) => void
  /** Opens a decision of a repository in the Decisions view. */
  onOpenDecision: (reportId: string, decision: number) => void
}

/** The repositories of the portal, then the drift queue of all of them. */
export function OverviewView({
  overview,
  portal,
  onOpenRepository,
  onOpenDecision,
}: OverviewViewProps) {
  const [queue, setQueue] = useState<Loadable<QueueRow[]>>({
    state: 'loading',
  })
  const [tab, setTab] = useState<Tab>('broken')
  const [repository, setRepository] = useState('')
  const repositoryLabel = useId()
  const panelId = useId()

  // A new overview, after a change of the draft, loads the queue again.
  useEffect(() => {
    let active = true
    portal.queue().then(
      body => active && setQueue({ state: 'ready', value: body.rows }),
      (error: unknown) =>
        active && setQueue({ state: 'error', message: errorMessage(error) })
    )
    return () => {
      active = false
    }
  }, [portal, overview])

  const rows = queue.state === 'ready' ? queue.value : []
  const ofRepository = rows.filter(
    row => repository === '' || row.reportId === repository
  )
  const visible =
    tab === 'all' ? ofRepository : ofRepository.filter(row => row.level === tab)
  const count = (candidate: Tab) =>
    candidate === 'all'
      ? ofRepository.length
      : ofRepository.filter(row => row.level === candidate).length

  return (
    <div className="overview">
      <LicenseNote portal={portal} />
      <UnservedNote repositories={overview.unserved ?? []} />
      <p className="content-note">
        {overview.refreshIntervalSeconds === 0
          ? 'The reports are computed when a page asks for them.'
          : `The portal computes the reports every ${refreshPeriod(overview.refreshIntervalSeconds)}.`}
      </p>
      <div className="table-wrap">
        <table className="signals repositories">
          <thead>
            <tr>
              <th scope="col">Repository</th>
              <th scope="col">Reference</th>
              <th scope="col">Decisions</th>
              <th scope="col">{LEVELS.broken.label}</th>
              <th scope="col">{LEVELS.review.label}</th>
              <th scope="col">{LEVELS.order.label}</th>
              <th scope="col">Covered zones</th>
              <th scope="col">Scanned</th>
            </tr>
          </thead>
          <tbody>
            {overview.repositories.map(r => (
              <RepositoryLine
                key={r.reportId}
                repository={r}
                onOpen={() => onOpenRepository(r.reportId)}
              />
            ))}
            {overview.problems.map(p => (
              <tr key={p.reportId}>
                <td>{p.reportId}</td>
                <td colSpan={7} role="alert">
                  The report cannot be read: {p.message}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Drift queue</h2>
      <p className="tab-hint">
        The signals of every repository, the most severe first, then the oldest
        citation first.
      </p>
      <div className="queue-filters">
        <label htmlFor={repositoryLabel}>Repository</label>
        <select
          id={repositoryLabel}
          className="select"
          value={repository}
          onChange={event => setRepository(event.target.value)}
        >
          <option value="">All repositories</option>
          {overview.repositories.map(r => (
            <option key={r.reportId} value={r.reportId}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
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
      <div id={panelId} role="tabpanel" className="table-wrap">
        {queue.state === 'loading' ? (
          <p className="empty">Loading the queue…</p>
        ) : queue.state === 'error' ? (
          <p className="empty" role="alert">
            The queue cannot be loaded: {queue.message}
          </p>
        ) : visible.length === 0 ? (
          <p className="empty">No signal at this level.</p>
        ) : (
          <table className="signals">
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col">Signal</th>
                <th scope="col">Repository</th>
                <th scope="col">Decision</th>
                <th scope="col">Cited</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <tr key={`${row.reportId}:${row.signalId}`}>
                  <td>
                    <LevelBadge level={row.level} />
                  </td>
                  <td>
                    <span className="signal-title">{row.title}</span>
                    <p className="signal-target">
                      <code>{row.target}</code>
                      {row.note && <span className="muted"> · {row.note}</span>}
                    </p>
                  </td>
                  <td className="area">{row.repository}</td>
                  <td>
                    <button
                      type="button"
                      className="signal-title"
                      title={row.decisionTitle ?? undefined}
                      onClick={() => onOpenDecision(row.reportId, row.decision)}
                    >
                      <code>{decisionLabel(row.decision)}</code>
                    </button>
                  </td>
                  <td className="muted">
                    {row.citedAt ? formatDate(row.citedAt) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function RepositoryLine({
  repository: r,
  onOpen,
}: {
  repository: RepositoryOverview
  onOpen: () => void
}) {
  return (
    <tr>
      <td>
        <button type="button" className="signal-title" onClick={onOpen}>
          {r.name}
        </button>
        {r.refreshError && (
          <p className="muted" role="alert">
            Last computation failed: {r.refreshError}
          </p>
        )}
      </td>
      <td>
        <code>
          {r.ref} · {shortCommit(r.commit)}
        </code>
      </td>
      <td>
        {numbers.format(r.decisions.inForce)} in force
        {r.decisions.proposed > 0 && (
          <span className="muted">
            {' '}
            · {numbers.format(r.decisions.proposed)} proposed
          </span>
        )}
      </td>
      <td>{numbers.format(r.signals.broken)}</td>
      <td>{numbers.format(r.signals.review)}</td>
      <td>{numbers.format(r.signals.order)}</td>
      <td>
        {r.zones === null
          ? '–'
          : `${numbers.format(r.zones.covered)} of ${numbers.format(r.zones.total)}`}
      </td>
      <td className="muted">{formatDate(r.generatedAt)}</td>
    </tr>
  )
}

function refreshPeriod(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600
    return hours === 1 ? 'hour' : `${hours} hours`
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return minutes === 1 ? 'minute' : `${minutes} minutes`
  }
  return `${seconds} seconds`
}
