import { useEffect, useId, useState } from 'react'
import type { AcceptRecommendation, AcceptSuggestion } from '@compadr/format'
import { formatDate } from '../drift/signals.ts'
import { AddToDraftButton, useDraft } from '../drafts/draft-context.tsx'
import type { ReportSource } from '../reports.ts'

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; value: AcceptSuggestion | null }
  | { state: 'error'; message: string }

const RECOMMENDATIONS: Record<
  AcceptRecommendation,
  { label: string; badge: string }
> = {
  accept: { label: 'Accept', badge: 'badge-in-sync' },
  'amend-then-accept': { label: 'Amend, then accept', badge: 'badge-review' },
  'keep-proposed': { label: 'Keep proposed', badge: 'badge-review' },
  withdraw: { label: 'Withdraw', badge: 'badge-broken' },
}

/**
 * The recommendation of the assist service on a proposed decision, and the
 * button that accepts it in the local draft. A model recommends; a person
 * accepts, then reviews the draft before it is published.
 */
export function RecommendationSection({
  source,
  id,
  decision,
  revisedAt,
  command,
}: {
  source: ReportSource
  id: string
  decision: number
  /** Last edit of the record, to tell a recommendation made before it. */
  revisedAt: string | null
  /** The command that writes the recommendation, when there is none. */
  command: string
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const headingId = useId()

  useEffect(() => {
    let active = true
    const read = source.recommendation?.(id, decision) ?? Promise.resolve(null)
    read.then(
      value => active && setLoaded({ state: 'ready', value }),
      (error: unknown) =>
        active &&
        setLoaded({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
    )
    return () => {
      active = false
    }
  }, [source, id, decision])

  if (loaded.state === 'loading') return null
  return (
    <section className="findings" aria-labelledby={headingId}>
      <h3 id={headingId} className="rules-title">
        Recommended by a model
      </h3>
      {loaded.state === 'error' ? (
        <p className="hint">
          The recommendation cannot be read: {loaded.message}
        </p>
      ) : loaded.value === null ? (
        <>
          <p className="hint">
            No recommendation yet. The assist service can read the decision and
            the code that cites it, and recommend what to do:
          </p>
          <pre className="code-block">
            <code>{command}</code>
          </pre>
        </>
      ) : (
        <RecommendationBody
          decision={decision}
          suggestion={loaded.value}
          revisedAt={revisedAt}
        />
      )}
    </section>
  )
}

function RecommendationBody({
  decision,
  suggestion,
  revisedAt,
}: {
  decision: number
  suggestion: AcceptSuggestion
  revisedAt: string | null
}) {
  const { draft, accept } = useDraft()
  // A record edited after the recommendation may say something else now.
  const stale =
    revisedAt !== null &&
    Date.parse(revisedAt) > Date.parse(suggestion.provenance.createdAt)
  const shown = RECOMMENDATIONS[suggestion.recommendation]
  return (
    <>
      <p className="finding-title">
        <span className={`badge ${shown.badge}`}>{shown.label}</span>{' '}
        {suggestion.explanation}
      </p>
      <p className="tab-hint">
        {suggestion.provenance.model} ({suggestion.provenance.promptVersion})
        recommended it on {formatDate(suggestion.provenance.createdAt)}. The
        guard of Compadr checked each quote and each line of code. A person
        decides.
      </p>
      {stale && (
        <p className="tab-hint findings-stale">
          The record changed on {formatDate(revisedAt)}, after this
          recommendation. Ask for a new recommendation before accepting the
          decision.
        </p>
      )}
      {suggestion.points.length > 0 && (
        <ul className="findings-list">
          {suggestion.points.map((point, index) => (
            <li key={index} className="finding">
              <blockquote className="finding-quote">{point.quote}</blockquote>
              <p className="finding-explanation">{point.finding}</p>
              {point.evidence === null ? (
                <p className="tab-hint">No excerpt of the code shows it.</p>
              ) : (
                <>
                  <p className="finding-place">
                    <code>{point.evidence.path}</code>
                  </p>
                  <pre className="finding-evidence">
                    <code>{point.evidence.text}</code>
                  </pre>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {suggestion.amendments.length > 0 && (
        <>
          <p className="hint">Change in the record before accepting it:</p>
          <ul className="findings-list">
            {suggestion.amendments.map((amendment, index) => (
              <li key={index}>{amendment}</li>
            ))}
          </ul>
        </>
      )}
      {suggestion.recommendation !== 'accept' || stale ? null : draft ? (
        <div className="notice">
          <p>
            Accepting adds a commit to the local draft {draft.name}: the status
            of the record becomes accepted, with the date of today. The commit
            names the recommendation. Review the draft, then publish it from the
            Draft page.
          </p>
          <AddToDraftButton
            label="Accept as recommended"
            add={() =>
              accept({
                decision,
                recommendation: {
                  recommendation: 'accept',
                  model: suggestion.provenance.model,
                  promptVersion: suggestion.provenance.promptVersion,
                },
              })
            }
          />
        </div>
      ) : (
        <p className="hint">
          To accept the decision, change its status to accepted in its record,
          in a pull request.
        </p>
      )}
    </>
  )
}
