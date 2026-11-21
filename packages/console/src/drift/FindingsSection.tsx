import { useEffect, useId, useState } from 'react'
import type {
  DriftReport,
  SemanticFinding,
  SemanticFindings,
} from '@compadr/format'
import { shortCommit } from '../format.ts'
import type { ReportSource } from '../reports.ts'
import { decisionLabel, formatDate } from './signals.ts'

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; value: SemanticFindings | null }
  | { state: 'error'; message: string }

const VERDICTS: Record<
  SemanticFinding['verdict'],
  { label: string; badge: string }
> = {
  violated: { label: 'Violated', badge: 'badge-broken' },
  'at-risk': { label: 'At risk', badge: 'badge-review' },
}

/**
 * The findings of the last semantic check on the report, after the guard:
 * suggestions of a model that a person reviews. Nothing shows when the
 * server keeps no findings for the report.
 */
export function FindingsSection({
  report,
  source,
  id,
}: {
  report: DriftReport
  source: ReportSource
  id: string
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const headingId = useId()

  useEffect(() => {
    let active = true
    const read = source.findings?.(id) ?? Promise.resolve(null)
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
    // A refreshed report reads the findings again.
  }, [source, id, report])

  if (loaded.state === 'loading') return null
  if (loaded.state === 'ready' && loaded.value === null) return null

  return (
    <section className="findings" aria-labelledby={headingId}>
      <h2 id={headingId} className="findings-heading">
        Suggested by a model
      </h2>
      {loaded.state === 'error' ? (
        <p className="tab-hint">
          The findings cannot be read: {loaded.message}
        </p>
      ) : (
        <FindingsBody report={report} findings={loaded.value!} />
      )}
    </section>
  )
}

function FindingsBody({
  report,
  findings,
}: {
  report: DriftReport
  findings: SemanticFindings
}) {
  const count = findings.findings.length
  const change =
    findings.base === null
      ? `a change on top of commit ${shortCommit(findings.repository.commit)}`
      : `the commits from ${shortCommit(findings.base)} to ${shortCommit(findings.repository.commit)}`
  return (
    <>
      <p className="tab-hint">
        {findings.model} ({findings.promptVersion}) read {change} on{' '}
        {formatDate(findings.generatedAt)}. The guard of Compadr checked each
        quote. A finding never fails the check: a person reviews it and decides.
        {findings.rejected > 0 &&
          ` The guard removed ${findings.rejected} finding${findings.rejected === 1 ? '' : 's'}.`}
        {findings.excluded.length > 0 &&
          ` ${findings.excluded.length} changed file${findings.excluded.length === 1 ? '' : 's'} stayed out, as compadr.yml asks.`}
      </p>
      {findings.repository.commit !== report.repository.commit && (
        <p className="tab-hint findings-stale">
          These findings are for commit{' '}
          {shortCommit(findings.repository.commit)}, and the report is at commit{' '}
          {shortCommit(report.repository.commit)}.
        </p>
      )}
      {count === 0 ? (
        <p className="empty findings-empty">
          The model found no break of a decision in force.
        </p>
      ) : (
        <ul className="findings-list">
          {findings.findings.map((finding, index) => (
            <FindingItem key={index} finding={finding} />
          ))}
        </ul>
      )}
    </>
  )
}

function FindingItem({ finding }: { finding: SemanticFinding }) {
  const verdict = VERDICTS[finding.verdict]
  const place =
    finding.line === null
      ? finding.evidence.path
      : `${finding.evidence.path}:${finding.line}`
  return (
    <li className="finding">
      <p className="finding-title">
        <span className={`badge ${verdict.badge}`}>{verdict.label}</span>{' '}
        <code>{decisionLabel(finding.decision)}</code> {finding.title}
      </p>
      <blockquote className="finding-quote">{finding.quote}</blockquote>
      <p className="finding-place">
        <code>{place}</code>
      </p>
      {finding.evidence.text.trim() !== '' && (
        <pre className="finding-evidence">
          <code>{finding.evidence.text}</code>
        </pre>
      )}
      <p className="finding-explanation">{finding.explanation}</p>
      {finding.notices.length > 0 && (
        <p className="tab-hint">
          Not verified by the guard: {finding.notices.join(' ')}
        </p>
      )}
    </li>
  )
}
