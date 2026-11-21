import { useId, useMemo, useState } from 'react'
import {
  proposedApplied,
  type Attribution,
  type DriftReport,
  type ReplacedRule,
} from '@compadr/format'
import type { DraftState } from '../drafts.ts'
import { LevelBadge } from '../drift/DriftView.tsx'
import { decisionLabel, formatDate, referenceTarget } from '../drift/signals.ts'
import { ruleWhereabouts } from '../features/features.ts'
import { StateBadge } from '../features/FeaturesView.tsx'
import { Markdown } from '../features/markdown.tsx'
import { AddToDraftButton, useDraft } from '../drafts/draft-context.tsx'
import { count, shortCommit } from '../format.ts'
import type { ReportSource } from '../reports.ts'
import type { PlainSource } from '../assist.ts'
import { PlainSection } from './PlainSection.tsx'
import { RecommendationSection } from './RecommendationSection.tsx'
import {
  decisionHistory,
  decisionPage,
  decisionRows,
  attributionLabel,
  describeAttribution,
  markCheckedCommand,
  type DecisionRow,
} from './decisions.ts'

/** The decisions of a report, and the page of the one selected. */
export function DecisionsView({
  report,
  selected,
  onSelect,
  recommendationOf,
  plainOf,
}: {
  report: DriftReport
  selected: number | undefined
  onSelect: (number: number | undefined) => void
  /** Where the recommendations on proposed decisions come from, if anywhere. */
  recommendationOf?: { source: ReportSource; id: string }
  /** Where the versions in plain language come from, when the server can ask. */
  plainOf?: { source: PlainSource; id: string }
}) {
  // The search outlives the page of a decision, so that Back finds it again.
  const [query, setQuery] = useState('')
  const page =
    selected === undefined ? undefined : decisionPage(report, selected)
  return page ? (
    <DecisionPageView
      // A new decision starts on its Overview, with no link ticked.
      key={selected}
      report={report}
      number={selected!}
      onBack={() => onSelect(undefined)}
      onSelect={onSelect}
      recommendationOf={recommendationOf}
      plainOf={plainOf}
    />
  ) : (
    <DecisionList
      report={report}
      query={query}
      onQuery={setQuery}
      onSelect={onSelect}
    />
  )
}

function matches(row: DecisionRow, query: string): boolean {
  const text = `${decisionLabel(row.decision.number)} ${row.decision.number} ${row.decision.title} ${row.feature?.label ?? ''}`
  return text.toLowerCase().includes(query.trim().toLowerCase())
}

function DecisionList({
  report,
  query,
  onQuery,
  onSelect,
}: {
  report: DriftReport
  query: string
  onQuery: (query: string) => void
  onSelect: (number: number) => void
}) {
  const rows = useMemo(() => decisionRows(report), [report])
  const applied = useMemo(() => proposedApplied(report), [report])
  const searchId = useId()
  const appliedId = useId()
  const visible = rows.filter(row => matches(row, query))
  return (
    <div className="decisions">
      <p className="content-note">
        {report.repository.ref} at commit{' '}
        {shortCommit(report.repository.commit)} ·{' '}
        {count(rows.length, 'decision')}
      </p>
      {applied.length > 0 && (
        <section className="proposed-applied" aria-labelledby={appliedId}>
          <h2 id={appliedId} className="section-title">
            Proposed but applied
          </h2>
          <p className="tab-hint">
            These decisions are proposed, and files of the code cite them
            already. If the code applies a decision, a person accepts it, or
            says in the record why it waits.
          </p>
          <ul className="file-list">
            {applied.map(({ decision, files }) => (
              <li key={decision.number}>
                <button
                  type="button"
                  className="signal-title"
                  onClick={() => onSelect(decision.number)}
                >
                  <code>{decisionLabel(decision.number)}</code> {decision.title}
                </button>
                <span className="muted">
                  {' '}
                  · cited by {count(files.length, 'file')} of the code
                  {decision.date && ` · proposed ${decision.date}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <label className="visually-hidden" htmlFor={searchId}>
        Search the decisions
      </label>
      <input
        id={searchId}
        className="search"
        type="search"
        placeholder="Search by number, title or feature"
        value={query}
        onChange={event => onQuery(event.target.value)}
      />
      <div className="table-wrap">
        {visible.length === 0 ? (
          <p className="empty">No decision matches the search.</p>
        ) : (
          <table className="signals decision-table">
            <thead>
              <tr>
                <th scope="col">Decision</th>
                <th scope="col">Status</th>
                <th scope="col">State</th>
                <th scope="col">Feature</th>
                <th scope="col">Links</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <tr key={row.decision.number}>
                  <td>
                    <button
                      type="button"
                      className="signal-title"
                      onClick={() => onSelect(row.decision.number)}
                    >
                      <code>{decisionLabel(row.decision.number)}</code>{' '}
                      {row.decision.title}
                    </button>
                  </td>
                  <td className="muted">{row.decision.status}</td>
                  <td>
                    <StateBadge state={row.state} />
                  </td>
                  <td className="area">{row.feature?.label ?? '–'}</td>
                  <td className="muted">
                    {row.links} · {row.citations} cited
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

/**
 * The names of an attribution, with a link to its pull request. A label that
 * already says the role leaves it out.
 */
function AttributionText({
  attribution,
  labelled = false,
}: {
  attribution: Attribution
  labelled?: boolean
}) {
  const pull = attribution.pullRequest
  if (attribution.source !== 'pull-request' || pull === undefined) {
    return <>{describeAttribution(attribution)}</>
  }
  return (
    <>
      {attribution.names.join(', ')} ({labelled ? 'pull request' : pull.role}{' '}
      <a href={pull.url} rel="noreferrer" title={pull.title}>
        #{pull.number}
      </a>
      )
    </>
  )
}

function ReplacedRules({
  rules,
  report,
}: {
  rules: ReplacedRule[]
  report: DriftReport
}) {
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  return (
    <ul className="replaced-rules" aria-label="Replaced rules">
      {rules.map(rule => (
        <li key={`${rule.target}:${rule.quote}`}>
          <q>{rule.quote}</q>{' '}
          <span className="muted">{ruleWhereabouts(rule, decisions)}</span>
        </li>
      ))}
    </ul>
  )
}

function DecisionPageView({
  report,
  number,
  onBack,
  onSelect,
  recommendationOf,
  plainOf,
}: {
  report: DriftReport
  number: number
  onBack: () => void
  onSelect: (number: number) => void
  recommendationOf?: { source: ReportSource; id: string }
  plainOf?: { source: PlainSource; id: string }
}) {
  const page = useMemo(() => decisionPage(report, number), [report, number])!
  const [tab, setTab] = useState<'overview' | 'history'>('overview')
  // References to record as checked, by identifier.
  const [toCheck, setToCheck] = useState<ReadonlySet<string>>(new Set())
  const { draft, check } = useDraft()
  // The draft after the last check added from this page.
  const [added, setAdded] = useState<DraftState>()
  const { decision } = page
  const inCode = page.citedBy.filter(file => file.inCode)
  const elsewhere = page.citedBy.filter(file => !file.inCode)
  const goTo = (target: number) => (
    <button
      type="button"
      className="link-button"
      onClick={() => onSelect(target)}
    >
      {decisionLabel(target)}
    </button>
  )
  return (
    <article className="decision-page" aria-label={decisionLabel(number)}>
      <button type="button" className="close" onClick={onBack}>
        ← Decisions
      </button>
      <h2 className="feature-title">
        <code>{decisionLabel(number)}</code> {decision.title}
      </h2>
      <p className="reading-meta">
        <StateBadge state={page.state} /> {decision.rawStatus || 'No status'}
        {decision.date && ` · decided ${decision.date}`}
        {decision.revisedAt && ` · last edit ${formatDate(decision.revisedAt)}`}
      </p>
      {decision.status === 'proposed' && inCode.length > 0 && (
        <div className="notice">
          <p>
            This decision is proposed, and {count(inCode.length, 'file')} of the
            code {inCode.length === 1 ? 'cites' : 'cite'} it. If the code
            applies the decision, accept it in its record, or say there why it
            waits.
          </p>
        </div>
      )}
      <dl className="facts">
        <dt>Feature</dt>
        <dd>{page.feature?.label ?? 'None'}</dd>
        {page.main !== null && (
          <>
            <dt>Main decision</dt>
            <dd>{goTo(page.main)}</dd>
          </>
        )}
        {decision.supersededBy.length > 0 && (
          <>
            <dt>Superseded by</dt>
            <dd>
              {decision.supersededBy.map((n, i) => (
                <span key={n}>
                  {i > 0 && ', '}
                  {goTo(n)}
                </span>
              ))}
            </dd>
          </>
        )}
        {decision.attribution && (
          <>
            <dt>{attributionLabel(decision.attribution)}</dt>
            <dd>
              <AttributionText attribution={decision.attribution} labelled />
            </dd>
          </>
        )}
        <dt>Record</dt>
        <dd>
          <code>{decision.file}</code>
        </dd>
      </dl>
      {plainOf !== undefined && (
        <PlainSection
          source={plainOf.source}
          id={plainOf.id}
          decision={number}
        />
      )}
      {decision.status === 'proposed' && recommendationOf !== undefined && (
        <RecommendationSection
          source={recommendationOf.source}
          id={recommendationOf.id}
          decision={number}
          revisedAt={decision.revisedAt ?? null}
          command={`compadr assist accept . --decision ${number} --out <findings-dir>/${recommendationOf.id}.accept-${number}.json`}
        />
      )}

      <div className="tabs" role="tablist" aria-label="Decision page">
        {(['overview', 'history'] as const).map(candidate => (
          <button
            key={candidate}
            type="button"
            role="tab"
            className="tab"
            aria-selected={candidate === tab}
            onClick={() => setTab(candidate)}
          >
            {candidate === 'overview' ? 'Overview' : 'History'}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <HistoryTab report={report} number={number} />
      ) : (
        <>
          {(decision.text?.relations ?? []).length > 0 && (
            <div className="reading-relations">
              {decision.text!.relations.map(relation => (
                <Markdown key={relation} source={relation} />
              ))}
            </div>
          )}
          {page.replaces.length > 0 && (
            <ReplacedRules rules={page.replaces} report={report} />
          )}

          <section className="page-section" aria-label="Code links">
            <h3 className="rules-title">
              Code links <span className="tab-count">{page.links.length}</span>
            </h3>
            {page.links.length === 0 ? (
              <p className="hint">The record cites no path and no symbol.</p>
            ) : (
              <table className="signals">
                <thead>
                  <tr>
                    <th scope="col">Cited</th>
                    <th scope="col">Cited on</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {page.links.map(link => (
                    <tr key={link.reference.id}>
                      <td>
                        <code>{referenceTarget(link.reference)}</code>
                        <p className="signal-target muted">
                          line {link.reference.adrLine} of the record
                        </p>
                      </td>
                      <td className="muted">
                        {link.reference.citedAt
                          ? formatDate(link.reference.citedAt)
                          : '–'}
                        {link.reference.checkedAt && (
                          <p className="signal-target">
                            checked {formatDate(link.reference.checkedAt)}
                            {link.reference.checkedBy && (
                              <>
                                {' by '}
                                <AttributionText
                                  attribution={link.reference.checkedBy}
                                />
                              </>
                            )}
                          </p>
                        )}
                      </td>
                      <td>
                        {link.level ? (
                          <LevelBadge level={link.level} />
                        ) : (
                          <span className="badge badge-in-sync">
                            <span aria-hidden="true">✓</span> In sync
                          </span>
                        )}
                        <p className="signal-target muted">{link.title}</p>
                        {(link.level === 'review' ||
                          link.level === 'order') && (
                          <label className="signal-target">
                            <input
                              type="checkbox"
                              checked={toCheck.has(link.reference.id)}
                              onChange={() =>
                                setToCheck(current => {
                                  const next = new Set(current)
                                  if (next.has(link.reference.id)) {
                                    next.delete(link.reference.id)
                                  } else next.add(link.reference.id)
                                  return next
                                })
                              }
                            />{' '}
                            Mark as checked
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {toCheck.size > 0 &&
              (draft ? (
                <div className="notice">
                  <p>
                    Once the code is checked, add the check to the local draft{' '}
                    {draft.name}. The draft dates the check: the signals of
                    these references then start from it. Publish the draft from
                    the Draft page.
                  </p>
                  <AddToDraftButton
                    label="Add to the draft"
                    add={() => check({ references: [...toCheck] })}
                    onAdded={state => {
                      setToCheck(new Set())
                      setAdded(state)
                    }}
                  />
                </div>
              ) : (
                <div className="notice">
                  <p>
                    Once the code is checked, record it in the repository. The
                    command opens a pull request that dates the check: the
                    signals of these references then start from it.
                  </p>
                  <pre className="code-block">
                    {markCheckedCommand(report.repository.ref, [...toCheck])}
                  </pre>
                </div>
              ))}
            {toCheck.size === 0 && added !== undefined && (
              <p className="hint" role="status">
                Added to the draft {added.name}, which now holds{' '}
                {count(added.commits.length, 'commit')}. The Draft page lists
                them and gives the command that publishes them.
              </p>
            )}
          </section>

          <section className="page-section" aria-label="Cited by">
            <h3 className="rules-title">
              Cited by{' '}
              <span className="tab-count">
                {page.citedBy.reduce((sum, file) => sum + file.lines.length, 0)}
              </span>
            </h3>
            {inCode.length === 0 && elsewhere.length === 0 ? (
              <p className="hint">No file cites this decision.</p>
            ) : (
              <ul className="file-list">
                {[...inCode, ...elsewhere].map(file => (
                  <li key={file.file}>
                    <code>{file.file}</code>{' '}
                    <span className="muted">
                      {file.lines.length === 1 ? 'line' : 'lines'}{' '}
                      {file.lines.join(', ')}
                      {!file.inCode && ' · documentation'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="page-section" aria-label="Decision">
            <h3 className="rules-title">Decision</h3>
            {(decision.text?.sections ?? []).length === 0 ? (
              <p className="hint">This record has no Decision section.</p>
            ) : (
              decision.text!.sections.map((section, index) => (
                <div key={section.line} className="reading-section">
                  {section.heading && (
                    <h4 className="reading-section-title">{section.heading}</h4>
                  )}
                  <Markdown
                    source={section.markdown}
                    marks={page.marks[index]}
                  />
                </div>
              ))
            )}
          </section>
        </>
      )}
    </article>
  )
}

function HistoryTab({
  report,
  number,
}: {
  report: DriftReport
  number: number
}) {
  const entries = useMemo(
    () => decisionHistory(report, number),
    [report, number]
  )
  if (entries.length === 0) {
    return (
      <p className="hint">
        The report gives no history for this record. A report of an older
        version of Compadr has none.
      </p>
    )
  }
  return (
    <section className="page-section" aria-label="History">
      <table className="signals">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Event</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => (
            <tr
              key={`${entry.kind}:${entry.commit ?? entry.text}:${entry.date}`}
            >
              <td className="muted">{formatDate(entry.date)}</td>
              <td>
                {entry.kind === 'commit' ? (
                  <>
                    {entry.text}{' '}
                    <span className="muted">
                      <code>{shortCommit(entry.commit!)}</code>
                      {entry.by && ` · ${entry.by.names.join(', ')}`}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="badge badge-in-sync">
                      <span aria-hidden="true">✓</span> Checked
                    </span>{' '}
                    <code>{entry.text}</code>
                    {entry.by && (
                      <span className="muted">
                        {' '}
                        by <AttributionText attribution={entry.by} />
                      </span>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
