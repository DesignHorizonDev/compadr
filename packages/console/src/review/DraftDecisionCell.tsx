import { useEffect, useState } from 'react'
import type { DraftDecisionOutcome, DraftDecisionSource } from '../assist.ts'
import { decisionLabel, formatDate } from '../drift/signals.ts'

type State =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'excluded' }
  | { state: 'waiting'; reason: string }
  | { state: 'asking' }
  | { state: 'ready'; value: DraftDecisionOutcome }
  | { state: 'error'; message: string; kept: boolean }

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * The record that the assist service drafts from the change of a branch. An
 * outcome already kept for the commit of the branch shows at once. Otherwise
 * a person asks for one: each draft costs. A person reviews the record in the
 * local draft before publishing it.
 */
export function DraftDecisionCell({
  source,
  reportId,
  branch,
}: {
  source: DraftDecisionSource
  reportId: string
  branch: string
}) {
  const [shown, setShown] = useState<State>({ state: 'loading' })

  useEffect(() => {
    let active = true
    source.cached(reportId).then(
      value =>
        active &&
        setShown(
          value === null
            ? { state: 'none' }
            : value === 'excluded'
              ? { state: 'excluded' }
              : 'waiting' in value
                ? { state: 'waiting', reason: value.waiting }
                : { state: 'ready', value }
        ),
      (error: unknown) =>
        active &&
        setShown({ state: 'error', message: message(error), kept: true })
    )
    return () => {
      active = false
    }
  }, [source, reportId])

  const ask = () => {
    setShown({ state: 'asking' })
    source.draft(reportId).then(
      value => setShown({ state: 'ready', value }),
      (error: unknown) =>
        setShown({ state: 'error', message: message(error), kept: false })
    )
  }

  if (shown.state === 'loading') return null
  if (shown.state === 'excluded') {
    return (
      <p className="hint">
        Every file of the change stays in the repository: assist.exclude of
        compadr.yml names it.
      </p>
    )
  }
  if (shown.state === 'waiting') {
    // The service is not asked until a person handles that draft.
    return (
      <p className="hint">
        {shown.reason.charAt(0).toUpperCase()}
        {shown.reason.slice(1)}.
      </p>
    )
  }
  if (shown.state === 'ready') return <Outcome value={shown.value} />
  return (
    <>
      {shown.state === 'error' && (
        <p className="hint" role="alert">
          {shown.kept
            ? `The outcome kept cannot be read: ${shown.message}`
            : `No draft: ${shown.message}`}
        </p>
      )}
      <button
        type="button"
        className="close"
        disabled={shown.state === 'asking'}
        onClick={ask}
        aria-label={`Draft a decision from the change of ${branch}`}
      >
        {shown.state === 'asking'
          ? 'Asking the assist service…'
          : 'Draft a decision from this change'}
      </button>
    </>
  )
}

function Outcome({ value }: { value: DraftDecisionOutcome }) {
  const { result } = value
  const written = `${value.model} (${value.promptVersion}) answered on ${formatDate(value.createdAt)}.`
  if (result.kind === 'not-needed') {
    return (
      <>
        <p>The change needs no new record: {result.reason}</p>
        <p className="signal-target muted">{written}</p>
      </>
    )
  }
  const points = [
    ...value.problems.map(p => p.message),
    ...(value.excluded.length > 0
      ? [
          `Left out of the request, as assist.exclude asks: ${value.excluded.join(', ')}.`,
        ]
      : []),
    ...result.notes,
  ]
  return (
    <>
      <p>
        <code>{decisionLabel(result.number)}</code> {result.title} is proposed
        in the local draft <code>{result.draft}</code>. Review it on the Draft
        page, then publish it: its pull request goes into the branch.
      </p>
      <p className="signal-target muted">{written}</p>
      {points.length > 0 && (
        <details>
          <summary>Points to check ({points.length})</summary>
          <ul>
            {points.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
