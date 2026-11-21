import { useEffect, useId, useState } from 'react'
import type {
  ConsolidateSuggestion,
  Feature,
  ValidatedRules,
} from '@compadr/format'
import { decisionLabel, formatDate } from '../drift/signals.ts'
import { AddToDraftButton, useDraft } from '../drafts/draft-context.tsx'
import type { ReportSource } from '../reports.ts'

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; value: ConsolidateSuggestion | null }
  | { state: 'error'; message: string }

type Rules = Pick<ValidatedRules, 'rules' | 'replaced' | 'conflicts'>

const labels = (numbers: readonly number[]) =>
  numbers.map(decisionLabel).join(', ')

/**
 * The rules in force of a declared feature, consolidated along the
 * amendments of its main decision: the rules that a person validated in
 * features.yml, and the suggestion of the assist service that a person can
 * validate in the local draft. A model suggests; a person validates, then
 * reviews the draft before it is published.
 */
export function ConsolidatedRules({
  feature,
  consolidationOf,
}: {
  feature: Feature
  /** Where the page reads the suggestion of the service, when it can. */
  consolidationOf?: { source: ReportSource; id: string }
}) {
  const headingId = useId()
  const main = feature.source === 'declared' ? feature.main : null
  const validated = feature.rules
  const stale = feature.staleRecords ?? []
  // The suggestion matters until a person validates rules that are current.
  const wanted = main !== null && (validated === undefined || stale.length > 0)
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  // App makes a new object at each render: the effect follows its parts.
  const source = consolidationOf?.source
  const id = consolidationOf?.id

  useEffect(() => {
    if (!wanted || source === undefined || id === undefined) return
    let active = true
    const read = source.consolidation?.(id, main) ?? Promise.resolve(null)
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
  }, [wanted, source, id, main])

  if (main === null) return null
  if (validated === undefined && consolidationOf === undefined) return null
  const file =
    consolidationOf === undefined
      ? `${feature.id}.consolidate-${main}.json`
      : `<findings-dir>/${consolidationOf.id}.consolidate-${main}.json`
  const consolidate = `compadr assist consolidate . --decision ${main} --out ${file}`
  return (
    <section className="findings" aria-labelledby={headingId}>
      <h3 id={headingId} className="rules-title">
        Consolidated rules
      </h3>
      {validated !== undefined && (
        <>
          <p className="tab-hint">
            A person validated these rules on {validated.validated}.{' '}
            {validated.model} ({validated.promptVersion}) consolidated them
            along {labels(validated.chain.map(c => c.decision))}, and the guard
            of Compadr checked each quote.
          </p>
          {stale.length > 0 && (
            <p className="tab-hint findings-stale">
              {labels(stale)} changed since the validation: these rules may be
              out of date. Consolidate them again, then validate the new rules.
            </p>
          )}
          <RuleList rules={validated} />
        </>
      )}
      {wanted &&
        consolidationOf !== undefined &&
        (loaded.state === 'loading' ? null : loaded.state === 'error' ? (
          <p className="hint">
            The consolidation cannot be read: {loaded.message}
          </p>
        ) : loaded.value === null || sameRules(loaded.value, validated) ? (
          <>
            <p className="hint">
              {loaded.value === null
                ? 'No consolidation yet.'
                : `The consolidation of the folder holds the rules validated on ${validated!.validated}.`}{' '}
              The assist service can read the chain of {decisionLabel(main)} and
              state the rules in force:
            </p>
            <pre className="code-block">
              <code>{consolidate}</code>
            </pre>
          </>
        ) : (
          <Suggestion
            feature={feature}
            suggestion={loaded.value}
            file={file}
            replaces={validated !== undefined}
          />
        ))}
    </section>
  )
}

/**
 * Whether a suggestion is the one that a person already validated. The
 * guard may have removed items of it before they went into features.yml, so
 * the validated rules are a part of it, and the validation comes after it.
 */
function sameRules(
  suggestion: ConsolidateSuggestion,
  validated: ValidatedRules | undefined
): boolean {
  if (validated === undefined) return false
  if (
    suggestion.provenance.model !== validated.model ||
    suggestion.provenance.promptVersion !== validated.promptVersion ||
    suggestion.provenance.createdAt.slice(0, 10) > validated.validated
  ) {
    return false
  }
  const holds = <T,>(all: readonly T[], kept: readonly T[]) => {
    const keys = new Set(all.map(item => JSON.stringify(item)))
    return kept.every(item => keys.has(JSON.stringify(item)))
  }
  return (
    holds(suggestion.rules, validated.rules) &&
    holds(suggestion.replaced, validated.replaced) &&
    holds(suggestion.conflicts, validated.conflicts)
  )
}

function Suggestion({
  feature,
  suggestion,
  file,
  replaces,
}: {
  feature: Feature
  suggestion: ConsolidateSuggestion
  file: string
  /** Whether rules validated before stand in features.yml. */
  replaces: boolean
}) {
  const { draft, validateRules } = useDraft()
  return (
    <div className="consolidation">
      <h4 className="reading-title">Suggested by a model</h4>
      <p className="tab-hint">
        {suggestion.provenance.model} ({suggestion.provenance.promptVersion})
        consolidated the chain on {formatDate(suggestion.provenance.createdAt)}.
        The guard of Compadr checks each quote again when a person validates the
        rules.
      </p>
      {suggestion.rules.length === 0 ? (
        <p className="empty">The model states no rule.</p>
      ) : (
        <RuleList rules={suggestion} />
      )}
      {suggestion.rules.length === 0 ? null : draft ? (
        <div className="notice">
          <p>
            Validating adds a commit to the local draft {draft.name}: the rules
            go into features.yml under {feature.id}
            {replaces ? ', in place of the rules validated before' : ''}. The
            server refuses a consolidation made on another commit. Review the
            draft, then publish it from the Draft page.
          </p>
          <AddToDraftButton
            label="Validate these rules"
            add={() => validateRules({ feature: feature.id })}
          />
        </div>
      ) : (
        <>
          <p className="hint">
            To validate these rules, write them into features.yml in a pull
            request:
          </p>
          <pre className="code-block">
            <code>{`compadr rules . --feature ${feature.id} --suggestion ${file} --open-pr`}</code>
          </pre>
        </>
      )}
    </div>
  )
}

function RuleList({ rules }: { rules: Rules }) {
  return (
    <>
      <ul className="findings-list" aria-label="Rules">
        {rules.rules.map((rule, index) => (
          <li key={index} className="finding">
            <p className="finding-title">
              {rule.rule}{' '}
              <span className="muted">({labels(rule.sources)})</span>
            </p>
            <blockquote className="finding-quote">{rule.quote}</blockquote>
          </li>
        ))}
      </ul>
      {rules.replaced.length > 0 && (
        <>
          <p className="hint">Replaced along the chain:</p>
          <ul className="findings-list" aria-label="Replaced along the chain">
            {rules.replaced.map((point, index) => (
              <li key={index}>
                {point.rule}{' '}
                <span className="muted">
                  ({decisionLabel(point.record)}, replaced by{' '}
                  {decisionLabel(point.replacedBy)})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {rules.conflicts.length > 0 && (
        <>
          <p className="hint">Points that the records leave open:</p>
          <ul className="findings-list" aria-label="Open points">
            {rules.conflicts.map((conflict, index) => (
              <li key={index}>
                {conflict.point}{' '}
                <span className="muted">({labels(conflict.records)})</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
