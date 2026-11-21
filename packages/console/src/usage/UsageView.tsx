import { useEffect, useId, useState } from 'react'
import type { PortalSource, UsageInfo } from '../portal.ts'

type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string }

const numbers = new Intl.NumberFormat('en-US')

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const KINDS: Record<string, string> = {
  check: 'Semantic check',
  consolidate: 'Rules in force',
  plain: 'Plain language',
  draft: 'Drafted decisions',
  accept: 'Acceptance',
}

/** The name of a month, from YYYY-MM. */
function monthName(month: string): string {
  const [year, index] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, index! - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Rows of a count by key, the largest first. */
function rows(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )
}

/**
 * The AI credits of the month, for the administrators: the volume that the
 * license includes, the cap, the credits used by kind and by repository.
 * An administrator sets the cap; the assist service stops at it.
 */
export function UsageView({ portal }: { portal: PortalSource }) {
  const [usage, setUsage] = useState<Loadable<UsageInfo | null>>({
    state: 'loading',
  })
  const [cap, setCap] = useState('')
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  const capId = useId()

  useEffect(() => {
    let active = true
    portal.usage().then(
      value => {
        if (!active) return
        setUsage({ state: 'ready', value })
        if (value !== null) setCap(String(value.cap))
      },
      (error: unknown) =>
        active && setUsage({ state: 'error', message: errorMessage(error) })
    )
    return () => {
      active = false
    }
  }, [portal])

  if (usage.state === 'loading') {
    return <p className="content-note">Loading the AI credits…</p>
  }
  if (usage.state === 'error') {
    return (
      <p className="content-note" role="alert">
        The AI credits cannot be loaded: {usage.message}
      </p>
    )
  }
  if (usage.value === null) {
    return (
      <p className="content-note">
        This portal does not ask the assist service. Set COMPADR_ASSIST_URL and
        COMPADR_ASSIST_TOKEN to offer the plain language of a record and the
        drafting of a decision.
      </p>
    )
  }
  const value = usage.value

  function save(next: number | null) {
    setBusy(true)
    setFailure(undefined)
    portal
      .setUsageCap(next)
      .then(
        updated => {
          setUsage({ state: 'ready', value: updated })
          setCap(String(updated.cap))
        },
        (error: unknown) => setFailure(errorMessage(error))
      )
      .finally(() => setBusy(false))
  }

  const digits = cap.trim()
  const typed =
    /^\d+$/.test(digits) && Number.isSafeInteger(Number(digits))
      ? Number(digits)
      : null
  return (
    <div className="usage">
      <p className="content-note">
        {monthName(value.month)}: {numbers.format(value.used)} of{' '}
        {numbers.format(value.cap)} {value.cap === 1 ? 'credit' : 'credits'}{' '}
        used. The license includes {numbers.format(value.included)}{' '}
        {value.included === 1 ? 'credit' : 'credits'} each month. At the cap,
        Compadr no longer asks the assist service, and the pages and the checks
        show a notice.
      </p>
      <form
        className="queue-filters"
        onSubmit={event => {
          event.preventDefault()
          if (typed !== null) save(typed)
        }}
      >
        <label htmlFor={capId}>Cap of the month</label>
        <input
          id={capId}
          className="select"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={cap}
          onChange={event => setCap(event.target.value)}
        />
        <button
          type="submit"
          className="close"
          disabled={busy || typed === null || typed === value.cap}
        >
          Set the cap
        </button>
        {value.capSet && (
          <button
            type="button"
            className="close"
            disabled={busy}
            onClick={() => save(null)}
          >
            Back to the included volume
          </button>
        )}
      </form>
      <p className="hint">
        {!value.capSet
          ? 'The cap equals the included volume: nothing is billed beyond the license.'
          : value.cap > value.included
            ? 'An administrator set this cap. The credits beyond the included volume count as an overage of the month.'
            : 'An administrator set this cap, within the included volume: nothing is billed beyond the license.'}
      </p>
      {failure && (
        <p className="notice" role="alert">
          {failure}
        </p>
      )}
      <UsageTable
        caption="By kind"
        heading="Kind"
        rows={rows(value.byKind).map(([kind, credits]) => [
          KINDS[kind] ?? kind,
          credits,
        ])}
      />
      <UsageTable
        caption="By repository"
        heading="Repository"
        rows={rows(value.byRepository)}
      />
    </div>
  )
}

function UsageTable({
  caption,
  heading,
  rows,
}: {
  caption: string
  heading: string
  rows: [string, number][]
}) {
  if (rows.length === 0) return null
  return (
    <div className="table-wrap">
      <table className="signals">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{heading}</th>
            <th scope="col">Credits</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, credits]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{numbers.format(credits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
