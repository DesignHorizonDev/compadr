import { useEffect, useId, useState } from 'react'
import { formatDate } from '../drift/signals.ts'
import { shortCommit } from '../format.ts'
import type {
  DraftReview as Review,
  Me,
  PortalSource,
  Verdict,
} from '../portal.ts'

type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The files of a unified patch, each with its lines. */
export function splitPatch(patch: string): { path: string; lines: string[] }[] {
  const files: { path: string; lines: string[] }[] = []
  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/.+ b\/(.+)$/.exec(line)
    if (header) {
      files.push({ path: header[1]!, lines: [] })
    } else if (files.length > 0 && line !== '') {
      files.at(-1)!.lines.push(line)
    }
  }
  return files
}

function lineClass(line: string): string | undefined {
  if (line.startsWith('+++') || line.startsWith('---')) return 'patch-meta'
  if (line.startsWith('@@')) return 'patch-hunk'
  if (line.startsWith('+')) return 'patch-add'
  if (line.startsWith('-')) return 'patch-del'
  return undefined
}

const VERDICT_LABELS: Record<Verdict, string> = {
  approve: 'approved',
  'request-changes': 'asked for changes',
  comment: 'commented',
}

/**
 * The review of a draft in a portal: its patch, the comments and the
 * reviews of the team, and the publication as one pull request once the
 * rule of the repository is met.
 */
export function DraftReview({
  portal,
  me,
  repository,
  draft,
  onPublished,
}: {
  portal: PortalSource
  me: Me
  repository: string
  draft: string
  /** Called after a publication, so that the page reads the draft again. */
  onPublished?: () => void
}) {
  const [commit, setCommit] = useState<string>()
  const [review, setReview] = useState<Loadable<Review>>({ state: 'loading' })
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [body, setBody] = useState('')
  const [comment, setComment] = useState({ path: '', line: '', body: '' })
  const ids = { body: useId(), path: useId(), line: useId(), text: useId() }

  useEffect(() => {
    let active = true
    portal.draftReview(repository, draft, commit).then(
      value => active && setReview({ state: 'ready', value }),
      (error: unknown) =>
        active && setReview({ state: 'error', message: errorMessage(error) })
    )
    return () => {
      active = false
    }
  }, [portal, repository, draft, commit])

  if (review.state === 'loading') {
    return <p className="content-note">Loading the review…</p>
  }
  if (review.state === 'error') {
    return (
      <p className="content-note" role="alert">
        The review cannot be loaded: {review.message}
      </p>
    )
  }
  const current = review.value
  const editor = me.role === 'editor' || me.role === 'admin'

  function act(work: () => Promise<Review>, then?: () => void) {
    setBusy(true)
    setFailure(undefined)
    work()
      .then(
        value => {
          setReview({ state: 'ready', value })
          then?.()
        },
        (error: unknown) => {
          setFailure(errorMessage(error))
          // The draft may have changed: the page reads it again, so that
          // the next action names its new tip.
          return portal.draftReview(repository, draft, commit).then(
            value => setReview({ state: 'ready', value }),
            () => {}
          )
        }
      )
      .finally(() => setBusy(false))
  }

  const files = splitPatch(current.patch)
  const latest = current.publications.at(-1)
  return (
    <section className="draft-review" aria-label="Review of the draft">
      <h2 className="section-title">Review</h2>
      <p className={current.rule.publishable ? 'hint' : 'notice'}>
        {current.rule.publishable
          ? current.rule.approvedBy.length > 0
            ? `You can publish the draft: ${current.rule.approvedBy.join(', ')} approved it.`
            : 'You can publish the draft: the repository needs no approval.'
          : `You cannot publish the draft yet: ${current.rule.reason}. Your own approval does not count for you.`}
      </p>
      {latest && (
        <p className="hint">
          Published by {latest.login} on {formatDate(latest.at)}
          {latest.pullRequest ? (
            <>
              {' '}
              as{' '}
              <a href={latest.pullRequest} rel="noreferrer noopener">
                {latest.pullRequest}
              </a>
            </>
          ) : (
            <> to {latest.pushedTo}</>
          )}
          {latest.tip !== current.tip && ', before the last commits'}.
        </p>
      )}
      {failure && (
        <p className="notice" role="alert">
          {failure}
        </p>
      )}

      <div className="queue-filters" role="group" aria-label="Patch shown">
        <button
          type="button"
          className="close"
          aria-pressed={commit === undefined}
          onClick={() => setCommit(undefined)}
        >
          Whole draft
        </button>
        {current.draft.commits.map(c => (
          <button
            key={c.commit}
            type="button"
            className="close"
            aria-pressed={commit === c.commit}
            title={c.subject}
            onClick={() => setCommit(c.commit)}
          >
            {shortCommit(c.commit)}
          </button>
        ))}
      </div>

      {files.map(file => (
        <div key={file.path} className="patch-file">
          <p className="patch-path">
            <code>{file.path}</code>
          </p>
          <pre className="code-block patch">
            {file.lines.map((line, i) => (
              <span key={i} className={lineClass(line)}>
                {line}
                {'\n'}
              </span>
            ))}
          </pre>
          <ul
            className="patch-comments"
            aria-label={`Comments on ${file.path}`}
          >
            {current.comments
              .filter(c => c.path === file.path)
              .map((c, i) => (
                <li key={i}>
                  <strong>{c.login}</strong>
                  {c.line !== null && <> on line {c.line}</>}
                  {c.tip !== current.tip && (
                    <span className="muted"> · on an earlier tip</span>
                  )}
                  : {c.body}
                </li>
              ))}
          </ul>
        </div>
      ))}
      {current.truncated && (
        <p className="hint">The patch is too long: the end is not shown.</p>
      )}

      {editor && (
        <form
          className="review-form"
          onSubmit={event => {
            event.preventDefault()
            const line =
              comment.line.trim() === '' ? null : Number(comment.line)
            act(
              () =>
                portal.commentDraft(repository, draft, {
                  tip: current.tip,
                  path: comment.path || current.files[0] || '',
                  line,
                  body: comment.body,
                }),
              () => setComment({ path: comment.path, line: '', body: '' })
            )
          }}
        >
          <label htmlFor={ids.path}>Comment on</label>
          <select
            id={ids.path}
            className="select"
            value={comment.path || current.files[0] || ''}
            onChange={event =>
              setComment({ ...comment, path: event.target.value })
            }
          >
            {current.files.map(path => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
          <label htmlFor={ids.line}>Line</label>
          <input
            id={ids.line}
            className="select review-line"
            inputMode="numeric"
            pattern="[0-9]*"
            value={comment.line}
            onChange={event =>
              setComment({ ...comment, line: event.target.value })
            }
          />
          <label htmlFor={ids.text} className="visually-hidden">
            Comment
          </label>
          <textarea
            id={ids.text}
            className="review-text"
            required
            value={comment.body}
            onChange={event =>
              setComment({ ...comment, body: event.target.value })
            }
          />
          <button type="submit" className="close" disabled={busy}>
            Add the comment
          </button>
        </form>
      )}

      <h3 className="rules-title">Reviews</h3>
      {current.reviews.length === 0 ? (
        <p className="muted">No review yet.</p>
      ) : (
        <ul className="patch-comments" aria-label="Reviews of the draft">
          {current.reviews.map((r, i) => (
            <li key={i}>
              <strong>{r.login}</strong> {VERDICT_LABELS[r.verdict]}
              {r.tip !== current.tip && (
                <span className="muted"> an earlier tip</span>
              )}
              {r.body !== '' && <>: {r.body}</>}
            </li>
          ))}
        </ul>
      )}

      {editor && (
        <div className="review-form">
          <label htmlFor={ids.body}>Message of the review</label>
          <textarea
            id={ids.body}
            className="review-text"
            value={body}
            onChange={event => setBody(event.target.value)}
          />
          <p>
            <button
              type="button"
              className="close"
              disabled={busy}
              onClick={() =>
                act(
                  () =>
                    portal.reviewDraft(repository, draft, {
                      tip: current.tip,
                      verdict: 'approve',
                      body,
                    }),
                  () => setBody('')
                )
              }
            >
              Approve
            </button>{' '}
            <button
              type="button"
              className="close"
              disabled={busy || body.trim() === ''}
              onClick={() =>
                act(
                  () =>
                    portal.reviewDraft(repository, draft, {
                      tip: current.tip,
                      verdict: 'request-changes',
                      body,
                    }),
                  () => setBody('')
                )
              }
            >
              Ask for changes
            </button>{' '}
            <button
              type="button"
              className="close"
              disabled={busy || !current.rule.publishable}
              onClick={() =>
                act(
                  () => portal.publishDraft(repository, draft, current.tip),
                  onPublished
                )
              }
            >
              Publish as one pull request
            </button>
          </p>
        </div>
      )}
    </section>
  )
}
