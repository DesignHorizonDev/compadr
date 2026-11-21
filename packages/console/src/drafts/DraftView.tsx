import { useId, useState } from 'react'
import { count, shortCommit } from '../format.ts'
import {
  discardDraftCommand,
  publishDraftCommand,
  type DraftState,
} from '../drafts.ts'
import type { Me, PortalSource } from '../portal.ts'
import { useDraft } from './draft-context.tsx'
import { DraftReview } from './DraftReview.tsx'

/** The local draft of the repository: its commits, and how to publish it. */
export function DraftView({
  reportId,
  portal,
  me,
}: {
  reportId: string | undefined
  /** The portal, which reviews and publishes the draft in the browser. */
  portal?: PortalSource
  me?: Me | null
}) {
  const { draft } = useDraft()
  if (draft === undefined) {
    return <p className="content-note">Loading the draft…</p>
  }
  if (draft === null) {
    return (
      <div className="content-note">
        <p>
          This console keeps no draft. The console server started with{' '}
          <code>compadr console</code> gathers the corrections of the pages in a
          local draft, unless it runs with <code>--no-draft</code>.
        </p>
      </div>
    )
  }
  return (
    <>
      <DraftList draft={draft} />
      <DraftContent
        draft={draft}
        reportId={reportId}
        review={portal && me ? { portal, me } : undefined}
      />
    </>
  )
}

/**
 * The drafts of the repository, which the whole team sees, and the choice of
 * the draft that the actions of the pages fill.
 */
function DraftList({ draft }: { draft: DraftState }) {
  const { selectDraft } = useDraft()
  const [name, setName] = useState('')
  const nameId = useId()
  const others = draft.drafts.filter(d => d.name !== draft.name)
  return (
    <div className="draft-list">
      <p>
        The actions of the pages fill the draft <strong>{draft.name}</strong>.
      </p>
      {others.length > 0 && (
        <ul aria-label="Other drafts of the repository">
          {others.map(other => (
            <li key={other.name}>
              <button
                type="button"
                className="link-button"
                onClick={() => selectDraft(other.name)}
              >
                {other.name}
              </button>{' '}
              <span className="muted">
                · {count(other.commits, 'commit')}
                {other.authors.length > 0 && (
                  <> by {other.authors.join(', ')}</>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="queue-filters"
        onSubmit={event => {
          event.preventDefault()
          if (name.trim() !== '') selectDraft(name.trim())
          setName('')
        }}
      >
        <label htmlFor={nameId}>Fill another draft</label>
        <input
          id={nameId}
          className="select"
          value={name}
          placeholder="name"
          pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
          onChange={event => setName(event.target.value)}
        />
        <button type="submit" className="close">
          Use this draft
        </button>
      </form>
    </div>
  )
}

function DraftContent({
  draft,
  reportId,
  review,
}: {
  draft: DraftState
  reportId: string | undefined
  review?: { portal: PortalSource; me: Me }
}) {
  const { showReport } = useDraft()
  if (draft.commits.length === 0) {
    return (
      <div className="content-note">
        <p>
          The draft {draft.name} is empty. The corrections made in the pages,
          such as “Mark as checked” or an anchor on a symbol, add a commit to
          it. The repository is never written, and nothing leaves the server
          before the draft is published.
        </p>
      </div>
    )
  }
  const onDraftReport = reportId === draft.reportId
  return (
    <div className="draft-view">
      <p>
        The draft <strong>{draft.name}</strong> holds{' '}
        {count(draft.commits.length, 'commit')}, from commit{' '}
        {shortCommit(draft.base ?? '')}
        {draft.baseBranch !== null && <> of {draft.baseBranch}</>}. The
        repository is never written. The draft leaves the server only when
        someone publishes it.
      </p>
      <ol className="draft-commits" aria-label="Commits of the draft">
        {draft.commits.map(commit => (
          <li key={commit.commit}>
            <code>{shortCommit(commit.commit)}</code> {commit.subject}
            {commit.author !== '' && (
              <span className="muted"> · {commit.author}</span>
            )}
          </li>
        ))}
      </ol>
      {draft.reportId !== null && (
        <p>
          <button
            type="button"
            className="close"
            disabled={onDraftReport}
            onClick={() => showReport(draft.reportId!)}
          >
            {onDraftReport
              ? 'The report of the draft is on screen'
              : 'Show the report of the draft'}
          </button>{' '}
          <button
            type="button"
            className="close"
            disabled={reportId === draft.baseReportId}
            onClick={() => showReport(draft.baseReportId)}
          >
            Show the report of the repository
          </button>
        </p>
      )}
      {review ? (
        <DraftReview
          key={`${draft.baseReportId}:${draft.name}`}
          portal={review.portal}
          me={review.me}
          repository={draft.baseReportId}
          draft={draft.name}
        />
      ) : (
        <>
          <p className="proposal-label">
            Publish the draft as one pull request with the command line
          </p>
          <pre className="code-block">{publishDraftCommand(draft)}</pre>
          <p className="proposal-label">Or delete it</p>
          <pre className="code-block">{discardDraftCommand(draft)}</pre>
        </>
      )}
    </div>
  )
}
