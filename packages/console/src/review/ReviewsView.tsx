import { useEffect, useId, useMemo, useState } from 'react'
import type { DriftReport } from '@compadr/format'
import { decisionLabel } from '../drift/signals.ts'
import { Markdown } from '../features/markdown.tsx'
import { count, shortCommit } from '../format.ts'
import type { ReportSource } from '../reports.ts'
import type { DraftDecisionSource } from '../assist.ts'
import type {
  BranchChange,
  ReviewList,
  ReviewSource,
  ReviewSummary,
} from '../reviews.ts'
import { DraftDecisionCell } from './DraftDecisionCell.tsx'
import { openPullRequestCommand, reviewCommands } from './commands.ts'
import { reviewPage, type OverlapReason } from './overlaps.ts'
import { safeHref } from '../links.ts'

type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string }

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * The branches that propose decisions, and the review of one record. With
 * `drafting`, the branches that propose none follow, each with the button
 * that asks the assist service for a record.
 */
export function ReviewsView({
  reviews,
  reports,
  baseReportId,
  drafting,
}: {
  reviews: ReviewSource
  reports: ReportSource
  /** The report the console shows: its repository's reviews are listed. */
  baseReportId: string
  /** The drafting of records, when the server offers it. */
  drafting?: DraftDecisionSource
}) {
  const [list, setList] = useState<Loadable<Required<ReviewList> | null>>({
    state: 'loading',
  })
  const [open, setOpen] = useState<{ review: ReviewSummary; number: number }>()

  useEffect(() => {
    let active = true
    reviews.list().then(
      value => active && setList({ state: 'ready', value }),
      (error: unknown) =>
        active && setList({ state: 'error', message: message(error) })
    )
    return () => {
      active = false
    }
  }, [reviews])

  if (open) {
    return (
      <ReviewPageView
        review={open.review}
        number={open.number}
        reports={reports}
        onBack={() => setOpen(undefined)}
      />
    )
  }
  if (list.state === 'loading') {
    return <p className="content-note">Looking for proposed decisions…</p>
  }
  if (list.state === 'error') {
    return (
      <p className="content-note" role="alert">
        The reviews cannot be loaded: {list.message}
      </p>
    )
  }
  if (list.value === null) {
    return (
      <div className="content-note">
        <p>
          The reviews read the branches of the repository. Start the console on
          the repository to see them:
        </p>
        <pre className="code-block">compadr console &lt;repository&gt;</pre>
      </div>
    )
  }
  const mine = list.value.reviews.filter(r => r.baseReportId === baseReportId)
  const changes = list.value.changes.filter(
    c => c.baseReportId === baseReportId
  )
  const others =
    drafting === undefined || changes.length === 0 ? null : (
      <ChangesSection changes={changes} drafting={drafting} />
    )
  if (mine.length === 0) {
    return (
      <>
        <p className="content-note">
          No branch adds or changes a decision with the status “proposed”.
        </p>
        {others}
      </>
    )
  }
  return (
    <>
      <div className="table-wrap">
        <table className="signals">
          <thead>
            <tr>
              <th scope="col">Proposed decision</th>
              <th scope="col">Branch</th>
              <th scope="col">Pull request</th>
            </tr>
          </thead>
          <tbody>
            {mine.flatMap(review =>
              review.proposed.map(record => (
                <tr key={`${review.reportId}:${record.number}`}>
                  <td>
                    <button
                      type="button"
                      className="signal-title"
                      onClick={() => setOpen({ review, number: record.number })}
                    >
                      <code>{decisionLabel(record.number)}</code> {record.title}
                    </button>
                    <p className="signal-target muted">
                      {record.change === 'added'
                        ? 'New record'
                        : 'Changed record'}
                    </p>
                  </td>
                  <td>
                    <code>{review.branch}</code>
                    <p className="signal-target muted">
                      {shortCommit(review.commit)}
                    </p>
                  </td>
                  <td>
                    {review.pullRequest ? (
                      <a
                        href={safeHref(review.pullRequest.url)}
                        rel="noreferrer"
                      >
                        #{review.pullRequest.number}
                        {review.pullRequest.draft ? ' (draft)' : ''}
                      </a>
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {others}
    </>
  )
}

/** The branches that change the code without proposing a record. */
function ChangesSection({
  changes,
  drafting,
}: {
  changes: BranchChange[]
  drafting: DraftDecisionSource
}) {
  const headingId = useId()
  return (
    <section className="findings" aria-labelledby={headingId}>
      <h3 id={headingId} className="rules-title">
        Branches without a proposed decision
      </h3>
      <p className="hint">
        These branches change the code and propose no record. The assist service
        can draft one from the change of a branch: the change leaves the
        machine, and each draft costs. The record, with the status proposed,
        goes into a new local draft that starts at the tip of the branch. A
        person reviews it there before publishing it.
      </p>
      <div className="table-wrap">
        <table className="signals">
          <thead>
            <tr>
              <th scope="col">Branch</th>
              <th scope="col">Pull request</th>
              <th scope="col">Decision</th>
            </tr>
          </thead>
          <tbody>
            {changes.map(change => (
              <tr key={change.reportId}>
                <td>
                  <code>{change.branch}</code>
                  <p className="signal-target muted">
                    {shortCommit(change.commit)}
                  </p>
                </td>
                <td>
                  {change.pullRequest ? (
                    <a href={safeHref(change.pullRequest.url)} rel="noreferrer">
                      #{change.pullRequest.number}
                      {change.pullRequest.draft ? ' (draft)' : ''}
                    </a>
                  ) : (
                    <span className="muted">None</span>
                  )}
                </td>
                <td>
                  <DraftDecisionCell
                    key={change.commit}
                    source={drafting}
                    reportId={change.reportId}
                    branch={change.branch}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ReviewPageView({
  review,
  number,
  reports,
  onBack,
}: {
  review: ReviewSummary
  number: number
  reports: ReportSource
  onBack: () => void
}) {
  const [report, setReport] = useState<Loadable<DriftReport>>({
    state: 'loading',
  })
  useEffect(() => {
    let active = true
    reports.get(review.reportId).then(
      value => active && setReport({ state: 'ready', value }),
      (error: unknown) =>
        active && setReport({ state: 'error', message: message(error) })
    )
    return () => {
      active = false
    }
  }, [reports, review.reportId])

  const back = (
    <button type="button" className="close" onClick={onBack}>
      ← Reviews
    </button>
  )
  if (report.state === 'loading') {
    return (
      <>
        {back}
        <p className="content-note">
          Reading the decisions of <code>{review.branch}</code>…
        </p>
      </>
    )
  }
  if (report.state === 'error') {
    return (
      <>
        {back}
        <p className="content-note" role="alert">
          The report of the branch cannot be loaded: {report.message}
        </p>
      </>
    )
  }
  return (
    <>
      {back}
      <ReviewDetail review={review} number={number} report={report.value} />
    </>
  )
}

const CRITERIA = [
  { id: 'hard', label: 'Hard to reverse' },
  { id: 'surprising', label: 'Surprising for a reader without context' },
  { id: 'trade-off', label: 'The result of a real trade-off' },
] as const

function Reason({ reason }: { reason: OverlapReason }) {
  if (reason.kind === 'relation') return <>{reason.text}</>
  const items = reason.kind === 'files' ? reason.files : reason.terms
  return (
    <>
      {reason.kind === 'files' ? 'Both cite ' : 'Both use '}
      {items.map((item, i) => (
        <span key={item}>
          {i > 0 && ', '}
          <code>{item}</code>
        </span>
      ))}
    </>
  )
}

function ReviewDetail({
  review,
  number,
  report,
}: {
  review: ReviewSummary
  number: number
  report: DriftReport
}) {
  const page = useMemo(() => reviewPage(report, number), [report, number])
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [reason, setReason] = useState('')
  const reasonId = useId()
  if (page === undefined) {
    return (
      <p className="content-note" role="alert">
        {decisionLabel(number)} is not in the report of{' '}
        <code>{review.branch}</code>.
      </p>
    )
  }
  const { decision } = page
  const commands = reviewCommands(review, reason)
  const pr = review.pullRequest
  const worthIt = checked.size > 0
  const toggle = (id: string) =>
    setChecked(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <article
      className="decision-page"
      aria-label={`Review of ${decisionLabel(number)}`}
    >
      <h2 className="feature-title">
        <code>{decisionLabel(number)}</code> {decision.title}
      </h2>
      <p className="reading-meta">
        {decision.rawStatus || 'proposed'} ·{' '}
        {pr ? (
          <a href={safeHref(pr.url)} rel="noreferrer">
            pull request #{pr.number}
          </a>
        ) : (
          <>
            branch <code>{review.branch}</code>
          </>
        )}
      </p>
      <dl className="facts">
        <dt>Feature</dt>
        <dd>{page.feature?.label ?? 'None'}</dd>
        {page.detailOf && (
          <>
            <dt>Detail of</dt>
            <dd>
              <code>{decisionLabel(page.detailOf.number)}</code>{' '}
              {page.detailOf.title}
            </dd>
          </>
        )}
        <dt>Record</dt>
        <dd>
          <code>{decision.file}</code>
        </dd>
      </dl>

      <section className="page-section" aria-label="Overlaps found">
        <h3 className="rules-title">
          Overlaps found{' '}
          <span className="tab-count">{page.overlaps.length}</span>
        </h3>
        {page.overlaps.length === 0 ? (
          <p className="hint">
            No decision shares a relation, a cited file or a term with this one.
          </p>
        ) : (
          <ul className="overlaps">
            {page.overlaps.map(({ decision: other, reasons }) => (
              <li key={other.number}>
                <code>{decisionLabel(other.number)}</code> {other.title}{' '}
                <span className="muted">({other.status})</span>
                <ul className="hint">
                  {reasons.map((reason, i) => (
                    <li key={i}>
                      <Reason reason={reason} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {page.sameFeature.length > 0 && (
          <details className="page-section">
            <summary>
              Other decisions of {page.feature?.label} (
              {page.sameFeature.length})
            </summary>
            <ul className="overlaps">
              {page.sameFeature.map(other => (
                <li key={other.number}>
                  <code>{decisionLabel(other.number)}</code> {other.title}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {(decision.text?.sections ?? []).length > 0 && (
        <section className="page-section" aria-label="Proposed decision">
          <h3 className="rules-title">Proposed decision</h3>
          {decision.text!.sections.map(section => (
            <div key={section.line} className="reading-section">
              {section.heading && (
                <h4 className="reading-section-title">{section.heading}</h4>
              )}
              <Markdown source={section.markdown} />
            </div>
          ))}
        </section>
      )}

      <section className="page-section" aria-label="Is it worth a record?">
        <h3 className="rules-title">Is it worth a record?</h3>
        <fieldset className="criteria">
          <legend className="visually-hidden">
            Criteria of a decision record
          </legend>
          {CRITERIA.map(criterion => (
            <label key={criterion.id}>
              <input
                type="checkbox"
                checked={checked.has(criterion.id)}
                onChange={() => toggle(criterion.id)}
              />{' '}
              {criterion.label}
            </label>
          ))}
        </fieldset>
        {!worthIt && (
          <div className="notice">
            <p>
              A decision that meets none of the three criteria belongs in the
              code. Make it a code note: a comment next to the code it governs,
              or a line of the documentation of that code.
            </p>
            {page.files.length > 0 ? (
              <p>
                The record cites{' '}
                {page.files.map((file, i) => (
                  <span key={file}>
                    {i > 0 && ', '}
                    <code>{file}</code>
                  </span>
                ))}
                .
              </p>
            ) : (
              <p>The record cites no file of the repository.</p>
            )}
          </div>
        )}
      </section>

      <section className="page-section" aria-label="Decide">
        <h3 className="rules-title">Decide</h3>
        {commands === null || pr === null ? (
          <>
            <p className="hint">
              A decision is accepted, changed or rejected on its pull request.
              This branch has none yet: open one as a draft.
            </p>
            <pre className="code-block">
              {openPullRequestCommand(review, `docs(adr): ${decision.title}`)}
            </pre>
          </>
        ) : (
          <>
            <p className="hint">
              The decision is accepted, changed or rejected on{' '}
              <a href={safeHref(pr.url)} rel="noreferrer">
                pull request #{pr.number}
              </a>
              . The merge of the pull request sets the date of acceptance.
            </p>
            <dl className="facts review-actions">
              <dt>Accept</dt>
              <dd>
                <pre className="code-block">{commands.accept}</pre>
              </dd>
              <dt>Request changes</dt>
              <dd>
                <pre className="code-block">{commands.requestChanges}</pre>
              </dd>
              <dt>
                <label htmlFor={reasonId}>Reject</label>
              </dt>
              <dd>
                <textarea
                  id={reasonId}
                  className="search"
                  rows={2}
                  placeholder="Reason of the rejection (required)"
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                />
                {commands.reject === null ? (
                  <p className="hint">A rejection carries its reason.</p>
                ) : (
                  <pre className="code-block">{commands.reject}</pre>
                )}
              </dd>
            </dl>
          </>
        )}
        <p className="hint">
          {count(page.overlaps.length, 'overlap')} found in the report of{' '}
          <code>{review.branch}</code> at {shortCommit(review.commit)}.
        </p>
      </section>
    </article>
  )
}
