import { useMemo, useState } from 'react'
import type { Decision, DriftReport, Feature } from '@compadr/format'
import { LevelBadge } from '../drift/DriftView.tsx'
import { decisionLabel, LEVELS } from '../drift/signals.ts'
import { count, shortCommit } from '../format.ts'
import type { ReportSource } from '../reports.ts'
import { ConsolidatedRules } from './ConsolidatedRules.tsx'
import {
  featureMap,
  featureReading,
  ruleWhereabouts,
  type DecisionState,
  type FeatureCard,
} from './features.ts'
import { Markdown } from './markdown.tsx'

const STATE_LABELS: Record<DecisionState, string> = {
  'in-sync': 'In sync',
  broken: LEVELS.broken.label,
  review: LEVELS.review.label,
  order: LEVELS.order.label,
}

/** The feature map, and the page of the feature it opens. */
export function FeaturesView({
  report,
  consolidationOf,
}: {
  report: DriftReport
  /** Where a feature page reads the consolidation of its rules, when it can. */
  consolidationOf?: { source: ReportSource; id: string }
}) {
  const [openId, setOpenId] = useState<string>()
  const open = report.features?.find(feature => feature.id === openId)
  return open ? (
    <FeaturePage
      key={open.id}
      report={report}
      feature={open}
      consolidationOf={consolidationOf}
      onBack={() => setOpenId(undefined)}
    />
  ) : (
    <FeatureMapView report={report} onOpen={setOpenId} />
  )
}

function StateDots({ states }: { states: DecisionState[] }) {
  return (
    <p className="state-dots" aria-hidden="true">
      {states.map((state, index) => (
        <span key={index} className={`state-dot state-dot-${state}`} />
      ))}
    </p>
  )
}

function stateSummary(states: DecisionState[]): string {
  const counts = new Map<DecisionState, number>()
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1)
  return (['broken', 'review', 'order', 'in-sync'] as const)
    .filter(state => counts.has(state))
    .map(state => `${counts.get(state)} ${STATE_LABELS[state].toLowerCase()}`)
    .join(' · ')
}

function FeatureMapView({
  report,
  onOpen,
}: {
  report: DriftReport
  onOpen: (id: string) => void
}) {
  const map = useMemo(() => featureMap(report), [report])
  return (
    <div className="features">
      <p className="content-note">
        {report.repository.ref} at commit{' '}
        {shortCommit(report.repository.commit)} ·{' '}
        {count(map.cards.length, 'feature')} ·{' '}
        {count(map.unassigned.length, 'decision')} in no feature
      </p>
      {map.proposed && (
        <div className="notice">
          <p>
            The repository declares no feature. Compadr proposes this grouping
            from the relations between the records and the code files they cite.
            Write it as a plan, edit it, then open a pull request:
          </p>
          <pre className="code-block">
            {`compadr features <path-to-${report.repository.name}> --ref ${report.repository.ref} --out features-plan.yml\ncompadr features <path-to-${report.repository.name}> --ref ${report.repository.ref} --plan features-plan.yml --open-pr`}
          </pre>
        </div>
      )}
      {map.cards.length === 0 ? (
        <p className="empty">
          No feature is declared, and no two decisions are linked by a relation
          or by the code files they cite.
        </p>
      ) : (
        <ul className="feature-cards">
          {map.cards.map(card => (
            <FeatureCardItem
              key={card.feature.id}
              card={card}
              onOpen={() => onOpen(card.feature.id)}
            />
          ))}
        </ul>
      )}
      {map.unassigned.length > 0 && (
        <p className="content-note unassigned">
          In no feature:{' '}
          {map.unassigned.map(d => decisionLabel(d.number)).join(', ')}
        </p>
      )}
      {(report.featureProblems ?? []).length > 0 && (
        <div className="notice" role="note">
          <p>These declarations are left out:</p>
          <ul>
            {report.featureProblems!.map(problem => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function FeatureCardItem({
  card,
  onOpen,
}: {
  card: FeatureCard
  onOpen: () => void
}) {
  return (
    <li className="feature-card">
      <button type="button" className="feature-card-title" onClick={onOpen}>
        {card.feature.label}
      </button>
      <p className="feature-card-meta">
        {card.main ? decisionLabel(card.main.number) : 'No main decision'} ·{' '}
        {count(card.details.length, 'detail')}
      </p>
      <StateDots states={card.states} />
      <p className="hint">{stateSummary(card.states)}</p>
      {card.replaced > 0 && (
        <p className="hint">{count(card.replaced, 'replaced rule')}</p>
      )}
    </li>
  )
}

export function StateBadge({ state }: { state: DecisionState }) {
  return state === 'in-sync' ? (
    <span className="badge badge-in-sync">
      <span aria-hidden="true">✓</span> In sync
    </span>
  ) : (
    <LevelBadge level={state} />
  )
}

function FeaturePage({
  report,
  feature,
  consolidationOf,
  onBack,
}: {
  report: DriftReport
  feature: Feature
  consolidationOf?: { source: ReportSource; id: string }
  onBack: () => void
}) {
  const entries = useMemo(
    () => featureReading(report, feature),
    [report, feature]
  )
  const decisions = useMemo(
    () => new Map<number, Decision>(report.decisions.map(d => [d.number, d])),
    [report]
  )
  return (
    <article className="feature-page" aria-label={feature.label}>
      <button type="button" className="close" onClick={onBack}>
        ← Feature map
      </button>
      <h2 className="feature-title">{feature.label}</h2>
      <p className="content-note">
        <code>{feature.id}</code> ·{' '}
        {feature.source === 'proposed'
          ? 'Proposed by Compadr'
          : 'Declared in the repository'}{' '}
        · {count(entries.length, 'decision')}
      </p>
      <ConsolidatedRules feature={feature} consolidationOf={consolidationOf} />
      <section className="rules" aria-label="Rules in force">
        <h3 className="rules-title">Rules in force</h3>
        <p className="hint">
          The main decision comes first, then its details in number order.
          Struck-through text is a rule that a later decision replaces.
        </p>
        {entries.map(entry => (
          <section
            key={entry.decision.number}
            className="reading-entry"
            aria-label={decisionLabel(entry.decision.number)}
          >
            <header className="reading-head">
              <p className="detail-kicker">
                {entry.role === 'main' ? 'Main decision' : 'Detail'}
              </p>
              <h4 className="reading-title">
                <code>{decisionLabel(entry.decision.number)}</code>{' '}
                {entry.decision.title}
              </h4>
              <p className="reading-meta">
                <StateBadge state={entry.state} /> {entry.decision.rawStatus}
                {entry.decision.date && ` · ${entry.decision.date}`}
              </p>
            </header>
            {(entry.decision.text?.relations ?? []).length > 0 && (
              <div className="reading-relations">
                {entry.decision.text!.relations.map(relation => (
                  <Markdown key={relation} source={relation} />
                ))}
              </div>
            )}
            {entry.changedElsewhere.length > 0 && (
              <p className="hint">
                Also changed by decisions of other features:{' '}
                {entry.changedElsewhere.map(decisionLabel).join(', ')}.
              </p>
            )}
            {entry.replaces.length > 0 && (
              <ul className="replaced-rules" aria-label="Replaced rules">
                {entry.replaces.map(rule => (
                  <li key={`${rule.target}:${rule.quote}`}>
                    <q>{rule.quote}</q>{' '}
                    <span className="muted">
                      {ruleWhereabouts(rule, decisions)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {entry.sections.length === 0 ? (
              <p className="hint">This record has no Decision section.</p>
            ) : (
              entry.sections.map(section => (
                <div key={section.line} className="reading-section">
                  {section.heading && (
                    <h5 className="reading-section-title">{section.heading}</h5>
                  )}
                  <Markdown source={section.markdown} marks={section.marks} />
                </div>
              ))
            )}
          </section>
        ))}
      </section>
    </article>
  )
}
