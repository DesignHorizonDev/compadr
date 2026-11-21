import { useId, useState } from 'react'
import type { CodeReference, DriftReport } from '@compadr/format'
import { count, shortCommit } from '../format.ts'
import { AddToDraftButton, useDraft } from '../drafts/draft-context.tsx'
import {
  anchorCommand,
  anchorEntry,
  LARGE_SYMBOL,
  offersLines,
  symbolLength,
} from './proposals.ts'

type PathReference = Extract<CodeReference, { kind: 'path' }>

/** The anchor proposed for a reference, and the command that writes it. */
export function AnchorProposal({
  report,
  reference,
}: {
  report: DriftReport
  reference: PathReference
}) {
  const [withLines, setWithLines] = useState(false)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const checkboxId = useId()
  const proposal = reference.proposal ?? null
  const { draft, anchor } = useDraft()

  if (proposal === null) {
    return (
      <section className="proposal" aria-label="Anchor proposal">
        <h3 className="proposal-title">Anchor on a symbol</h3>
        <p className="hint">
          No anchor can be proposed: the engine found no single declaration that
          held the cited line, in a language it reads.
        </p>
      </section>
    )
  }

  const command = anchorCommand(report, reference, withLines)
  const large = symbolLength(proposal) > LARGE_SYMBOL

  function copyCommand() {
    // The clipboard can be refused, for example outside a secure context.
    navigator.clipboard.writeText(command).then(
      () => setCopy('copied'),
      () => setCopy('failed')
    )
  }

  return (
    <section className="proposal" aria-label="Anchor proposal">
      <h3 className="proposal-title">Anchor on a symbol</h3>
      <p>
        Replace <code>{reference.text}</code> by <code>{proposal.text}</code>.
      </p>
      <p className="hint">
        The symbol spans lines {proposal.symbolLines.start}–
        {proposal.symbolLines.end} ({count(symbolLength(proposal), 'line')}) at
        commit {shortCommit(report.repository.commit)}.
      </p>
      {offersLines(proposal) && (
        <p className="proposal-option">
          <input
            id={checkboxId}
            type="checkbox"
            checked={withLines}
            onChange={event => {
              setWithLines(event.target.checked)
              setCopy('idle')
            }}
          />{' '}
          <label htmlFor={checkboxId}>
            Also track the cited lines ({count(proposal.lines!.count, 'line')},
            now at line {proposal.lines!.start})
          </label>
        </p>
      )}
      {large && proposal.lines === null && (
        <p className="hint">
          The cited lines were not found once in the symbol: only the symbol can
          be tracked.
        </p>
      )}
      <p className="proposal-label">The record receives</p>
      <pre className="code-block">{anchorEntry(proposal, withLines)}</pre>
      {draft && (
        <>
          <p className="proposal-label">
            Add the anchor to the local draft {draft.name}
          </p>
          <AddToDraftButton
            key={String(withLines)}
            label="Add to the draft"
            add={() => anchor({ references: [reference.id], withLines })}
          />
        </>
      )}
      <p className="proposal-label">
        {draft
          ? 'Or open a pull request of its own with the command line'
          : 'Open a pull request with the command line'}
      </p>
      <pre className="code-block">{command}</pre>
      <button type="button" className="close" onClick={copyCommand}>
        {copy === 'copied' ? 'Copied' : 'Copy the command'}
      </button>
      {copy === 'failed' && (
        <p className="hint" role="alert">
          The browser refused the copy: select the command above instead.
        </p>
      )}
    </section>
  )
}
