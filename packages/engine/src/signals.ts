import {
  isInForce,
  normalizeStatus,
  type Decision,
  type Signal,
} from '@compadr/format'
import type { Corpus } from './read-corpus.ts'
import { changedBy } from './relations.ts'
import type { Repository } from './repository.ts'

type SignalOf<T extends Signal['type']> = Extract<Signal, { type: T }>

const pad = (n: number) => String(n).padStart(4, '0')

/**
 * The date a reference is anchored to: the later of its citation and of its
 * last check, or else the last change of the record.
 */
function anchorOf(
  reference: { citedAt: string | null; checkedAt?: string | null },
  decision: Decision | undefined
): string | null {
  const { citedAt, checkedAt } = reference
  if (citedAt && checkedAt) return citedAt > checkedAt ? citedAt : checkedAt
  return citedAt ?? checkedAt ?? decision?.revisedAt ?? null
}

// A decision changed by this many decisions or more is a candidate for
// consolidation.
export const CHAIN_LENGTH = 3

/**
 * Signals that compare each path reference with the code: a missing path, a
 * cited line beyond the end of its file, a cited line changed after its
 * citation, a cited line in a file changed since (it may have moved), and the
 * files linked to an accepted decision that changed since their citation.
 */
async function referenceSignals(
  repo: Repository,
  corpus: Corpus
): Promise<Signal[]> {
  const byDecision = new Map<number, Decision>(
    corpus.decisions.map(decision => [decision.number, decision])
  )
  // The history starts at the oldest date a reference is anchored to.
  const anchors = corpus.references.flatMap(reference => {
    const decision = byDecision.get(reference.decision)
    const anchor = anchorOf(reference, decision)
    return anchor ? [anchor] : []
  })
  const history = await repo.history(
    anchors.length > 0
      ? anchors.reduce((a, b) => (a < b ? a : b))
      : '1970-01-01'
  )

  const signals: Signal[] = []
  for (const decision of corpus.decisions) {
    // Each linked file or folder keeps the date of its most recent reference.
    const linkedSince = new Map<string, string>()
    for (const reference of corpus.references) {
      if (reference.decision !== decision.number || reference.kind !== 'path') {
        continue
      }
      const anchor = anchorOf(reference, decision)
      if (reference.resolvedPaths.length === 0) {
        signals.push({
          type: 'path-missing',
          level: 'broken',
          id: `path-missing:${reference.id}`,
          decision: decision.number,
          reference: reference.id,
        } satisfies SignalOf<'path-missing'>)
        continue
      }
      if (anchor === null) continue
      for (const path of reference.resolvedPaths) {
        const since = linkedSince.get(path)
        if (since === undefined || anchor > since) linkedSince.set(path, anchor)
      }
      const files = reference.resolvedPaths.filter(path => repo.files.has(path))
      // A line is checked only when the path names one file.
      if (reference.lines === null || files.length !== 1) continue
      const file = files[0]!
      const line = reference.lines.start
      const fileLineCount = await repo.lineCount(file)
      if (line > fileLineCount) {
        signals.push({
          type: 'cited-line-out-of-range',
          level: 'broken',
          id: `cited-line-out-of-range:${reference.id}`,
          decision: decision.number,
          reference: reference.id,
          fileLineCount,
        } satisfies SignalOf<'cited-line-out-of-range'>)
        continue
      }
      const lineChangedAt = await repo.lineDate(file, line)
      if (lineChangedAt !== null && lineChangedAt > anchor) {
        signals.push({
          type: 'cited-line-changed',
          level: 'review',
          id: `cited-line-changed:${reference.id}`,
          decision: decision.number,
          reference: reference.id,
          citedAt: anchor,
          lineChangedAt,
        } satisfies SignalOf<'cited-line-changed'>)
        continue
      }
      // The line is older than its citation, but code inserted above it can
      // have moved it: git blame does not see that.
      const commitsSince = history.commitsSince(file, anchor)
      if (commitsSince > 0) {
        signals.push({
          type: 'cited-file-changed',
          level: 'order',
          id: `cited-file-changed:${reference.id}`,
          decision: decision.number,
          reference: reference.id,
          citedAt: anchor,
          commitsSince,
        } satisfies SignalOf<'cited-file-changed'>)
      }
    }

    if (decision.status !== 'accepted') continue
    const changed = [...linkedSince]
      .filter(([path]) => !path.startsWith(`${corpus.adrDir}/`))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, since]) => ({
        path,
        since,
        commitsSince: history.commitsSince(path, since),
      }))
      .filter(file => file.commitsSince > 0)
    if (changed.length > 0) {
      signals.push({
        type: 'linked-files-changed',
        level: 'order',
        id: `linked-files-changed:${pad(decision.number)}`,
        decision: decision.number,
        oldestCitedAt: changed
          .map(file => file.since)
          .reduce((a, b) => (a < b ? a : b)),
        files: changed.map(({ path, commitsSince }) => ({
          path,
          commitsSince,
        })),
      } satisfies SignalOf<'linked-files-changed'>)
    }
  }
  return signals
}

/**
 * Signals on the citations of decisions: the code cites a decision that is no
 * longer in force, or the repository cites a decision that does not exist.
 */
function citationSignals(corpus: Corpus): Signal[] {
  const byDecision = new Map<number, Decision>(
    corpus.decisions.map(decision => [decision.number, decision])
  )
  const signals: Signal[] = []
  for (const citation of corpus.citations) {
    const cited = byDecision.get(citation.decision)
    const where = `${pad(citation.decision)}:${citation.file}:${citation.line}`
    if (cited === undefined) {
      signals.push({
        type: 'unknown-decision-cited',
        level: 'broken',
        id: `unknown-decision-cited:${where}`,
        decision: citation.decision,
        file: citation.file,
        line: citation.line,
      } satisfies SignalOf<'unknown-decision-cited'>)
    } else if (citation.inCode && !isInForce(cited.status)) {
      signals.push({
        type: 'superseded-decision-cited',
        level: 'broken',
        id: `superseded-decision-cited:${where}`,
        decision: citation.decision,
        file: citation.file,
        line: citation.line,
        supersededBy: cited.supersededBy,
      } satisfies SignalOf<'superseded-decision-cited'>)
    }
  }
  // Two citations of the same decision on the same line make one signal.
  return [...new Map(signals.map(signal => [signal.id, signal])).values()]
}

/** Signals on the health of the corpus, outside drift. */
function corpusSignals(corpus: Corpus): Signal[] {
  const signals: Signal[] = []
  for (const decision of corpus.decisions) {
    const indexStatus = corpus.indexStatuses.get(decision.number)
    if (indexStatus === undefined) continue
    const fromIndex = normalizeStatus(indexStatus)
    if (
      fromIndex !== decision.status &&
      fromIndex !== 'unknown' &&
      decision.status !== 'unknown'
    ) {
      signals.push({
        type: 'index-status-mismatch',
        level: 'broken',
        id: `index-status-mismatch:${pad(decision.number)}`,
        decision: decision.number,
        indexStatus,
        recordStatus: decision.rawStatus,
      } satisfies SignalOf<'index-status-mismatch'>)
    }
  }

  const known = new Set(corpus.decisions.map(decision => decision.number))
  const chains = [...changedBy(corpus.decisions)]
    .filter(
      ([target, newer]) => known.has(target) && newer.length >= CHAIN_LENGTH
    )
    .sort(([a, x], [b, y]) => y.length - x.length || a - b)
  for (const [target, amendedBy] of chains) {
    signals.push({
      type: 'amendment-chain',
      level: 'info',
      id: `amendment-chain:${pad(target)}`,
      decision: target,
      amendedBy,
    } satisfies SignalOf<'amendment-chain'>)
  }

  const linked = new Set([
    ...corpus.references
      .filter(r => r.kind === 'path' && r.resolvedPaths.length > 0)
      .map(r => r.decision),
    ...corpus.citations.map(citation => citation.decision),
  ])
  for (const decision of corpus.decisions) {
    if (decision.status === 'accepted' && !linked.has(decision.number)) {
      signals.push({
        type: 'decision-without-code',
        level: 'info',
        id: `decision-without-code:${pad(decision.number)}`,
        decision: decision.number,
      } satisfies SignalOf<'decision-without-code'>)
    }
  }
  return signals
}

/** Every signal of a corpus, in a stable order. */
export async function computeSignals(
  repo: Repository,
  corpus: Corpus
): Promise<Signal[]> {
  return [
    ...(await referenceSignals(repo, corpus)),
    ...citationSignals(corpus),
    ...corpusSignals(corpus),
  ]
}
