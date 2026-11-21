// `compadr anchor`: replaces references that cite lines by the anchors that
// the drift report proposes, on a new branch.
import {
  applyAnchorEdits,
  type AnchorEdit,
  type DriftReport,
} from '@compadr/format'
import type { Correction } from './publish.ts'

export class AnchorCommandError extends Error {}

export interface AnchorRequest {
  /** Identifiers of the references to anchor (`0037:services/billing.ts:116:1`). */
  references: string[]
  /** Also track the cited lines, when the proposal found them. */
  withLines: boolean
  branch?: string
  title?: string
  body?: string
}

/** The edits of each record, from the proposals of the report. */
export function anchorEdits(
  report: DriftReport,
  request: AnchorRequest
): Map<string, AnchorEdit[]> {
  const byId = new Map(report.references.map(r => [r.id, r]))
  const records = new Map(report.decisions.map(d => [d.number, d.file]))
  const edits = new Map<string, AnchorEdit[]>()
  for (const id of new Set(request.references)) {
    const reference = byId.get(id)
    if (reference === undefined) {
      throw new AnchorCommandError(`no reference ${id} in the report`)
    }
    const proposal = reference.kind === 'path' ? reference.proposal : null
    if (proposal === null || proposal === undefined) {
      throw new AnchorCommandError(
        `reference ${id} (${reference.text}) has no anchor proposal`
      )
    }
    const file = records.get(reference.decision)!
    const lines =
      request.withLines && proposal.lines !== null
        ? {
            count: proposal.lines.count,
            fingerprint: proposal.lines.fingerprint,
          }
        : null
    edits.set(file, [
      ...(edits.get(file) ?? []),
      {
        adrLine: reference.adrLine,
        column: reference.column,
        from: reference.text,
        to: proposal.text,
        anchor: { fingerprint: proposal.fingerprint, lines },
      },
    ])
  }
  return edits
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The new branch, its records and its message. */
export async function buildCorrection(
  repository: string,
  report: DriftReport,
  request: AnchorRequest,
  readRecord: (file: string) => Promise<string>
): Promise<Correction> {
  const edits = anchorEdits(report, request)
  const files = new Map<string, string>()
  for (const [file, fileEdits] of edits) {
    files.set(file, applyAnchorEdits(await readRecord(file), fileEdits))
  }
  const all = [...edits.values()].flat()
  const decisions = [
    ...new Set(
      report.references
        .filter(r => request.references.includes(r.id))
        .map(r => String(r.decision).padStart(4, '0'))
    ),
  ].sort()
  const commit = report.repository.commit
  return {
    repository,
    commit,
    branch:
      request.branch ??
      `compadr/anchor-${decisions.join('-')}-${commit.slice(0, 8)}`,
    title:
      request.title ??
      `docs(adr): anchor ${plural(all.length, 'reference')} on symbols`,
    body:
      request.body ??
      [
        'Compadr replaces references that cite line numbers by references to the symbols that hold the code, with a fingerprint of each symbol.',
        '',
        ...all.map(edit => `- \`${edit.from}\` → \`${edit.to}\``),
        '',
        `Proposed from commit ${commit.slice(0, 8)}.`,
      ].join('\n'),
    files,
  }
}
