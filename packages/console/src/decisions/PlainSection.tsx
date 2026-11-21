import { useEffect, useId, useState } from 'react'
import type { PlainSuggestion } from '@compadr/format'
import type { PlainSource } from '../assist.ts'
import { formatDate } from '../drift/signals.ts'

type State =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'excluded' }
  | { state: 'asking' }
  | { state: 'ready'; value: PlainSuggestion }
  | { state: 'error'; message: string; kept: boolean }

/**
 * The record in plain language, written by the assist service. A version
 * already kept for the record shows at once. Otherwise a person asks for
 * one: each new version costs. The record stays the reference.
 */
export function PlainSection({
  source,
  id,
  decision,
}: {
  source: PlainSource
  id: string
  decision: number
}) {
  const [shown, setShown] = useState<State>({ state: 'loading' })
  const headingId = useId()

  useEffect(() => {
    let active = true
    source.cached(id, decision).then(
      value =>
        active &&
        setShown(
          value === null
            ? { state: 'none' }
            : value === 'excluded'
              ? { state: 'excluded' }
              : { state: 'ready', value }
        ),
      (error: unknown) =>
        active &&
        setShown({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
          kept: true,
        })
    )
    return () => {
      active = false
    }
  }, [source, id, decision])

  const ask = () => {
    setShown({ state: 'asking' })
    source.read(id, decision).then(
      value => setShown({ state: 'ready', value }),
      (error: unknown) =>
        setShown({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
          kept: false,
        })
    )
  }

  if (shown.state === 'loading') return null
  return (
    <section className="findings" aria-labelledby={headingId}>
      <h3 id={headingId} className="rules-title">
        In plain language
      </h3>
      {shown.state === 'excluded' ? (
        <p className="hint">
          This record stays in the repository: assist.exclude of compadr.yml
          names it.
        </p>
      ) : shown.state === 'ready' ? (
        <>
          <p className="tab-hint">
            {shown.value.provenance.model} (
            {shown.value.provenance.promptVersion}) wrote this version on{' '}
            {formatDate(shown.value.provenance.createdAt)}. It may leave out or
            misread a point: the record stays the reference.
          </p>
          <div className="plain-summary">
            {shown.value.summary
              .split(/\n\s*\n/)
              .map(part => part.trim())
              .filter(part => part !== '')
              .map((part, index) => (
                <p key={index}>{part}</p>
              ))}
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            The assist service can write this record in plain language. The text
            of the record leaves the machine, and each new version costs. The
            console keeps the version until the record changes.
          </p>
          {shown.state === 'error' && (
            <p className="hint" role="alert">
              {shown.kept
                ? `The version kept cannot be read: ${shown.message}`
                : `No version: ${shown.message}`}
            </p>
          )}
          <button
            type="button"
            className="close"
            disabled={shown.state === 'asking'}
            onClick={ask}
          >
            {shown.state === 'asking'
              ? 'Asking the assist service…'
              : 'Read in plain language'}
          </button>
        </>
      )}
    </section>
  )
}
