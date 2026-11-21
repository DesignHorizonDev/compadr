// What the console shows of the anchors proposed by a drift report, and the
// command that writes one on a branch. The console never writes a record: the
// command line does, in a temporary clone.
import type {
  AnchorProposal,
  CodeReference,
  DriftReport,
} from '@compadr/format'
import { shellArgument } from '../review/commands.ts'

type PathReference = Extract<CodeReference, { kind: 'path' }>

/**
 * A symbol of more lines than this is large: any change of it leaves the
 * anchor to review, so the console offers to track the cited lines as well.
 */
export const LARGE_SYMBOL = 40

export function symbolLength(proposal: AnchorProposal): number {
  return proposal.symbolLines.end - proposal.symbolLines.start + 1
}

/** True when the console offers to also track the cited lines. */
export function offersLines(proposal: AnchorProposal): boolean {
  return proposal.lines !== null && symbolLength(proposal) > LARGE_SYMBOL
}

/** `compadr anchor` command that opens a pull request for one reference. */
export function anchorCommand(
  report: DriftReport,
  reference: PathReference,
  withLines: boolean
): string {
  return [
    'compadr anchor',
    // A placeholder that the user replaces, so it stays unquoted.
    `<path-to-${report.repository.name}>`,
    '--ref',
    shellArgument(report.repository.ref),
    '--adr-dir',
    shellArgument(report.repository.adrDir),
    '--reference',
    shellArgument(reference.id),
    ...(withLines ? ['--with-lines'] : []),
    '--open-pr',
  ].join(' ')
}

/** The `compadr.anchors` entry that the record will receive. */
export function anchorEntry(
  proposal: AnchorProposal,
  withLines: boolean
): string {
  const lines = [
    'compadr:',
    '  anchors:',
    `    "${proposal.text}":`,
    `      fingerprint: ${proposal.fingerprint}`,
  ]
  if (withLines && proposal.lines !== null) {
    lines.push(
      `      lines: { count: ${proposal.lines.count}, fingerprint: ${proposal.lines.fingerprint} }`
    )
  }
  return lines.join('\n')
}

export interface LinkRow {
  reference: PathReference
  proposal: AnchorProposal | null
}

/**
 * The links that still rely on a line number: the path references that cite
 * lines, with an anchor proposal first, then by decision.
 */
export function linksToRepair(report: DriftReport): LinkRow[] {
  return report.references
    .filter(
      (reference): reference is PathReference =>
        reference.kind === 'path' &&
        reference.anchor === null &&
        reference.lines !== null
    )
    .map(reference => ({ reference, proposal: reference.proposal ?? null }))
    .sort(
      (a, b) =>
        Number(b.proposal !== null) - Number(a.proposal !== null) ||
        a.reference.decision - b.reference.decision ||
        a.reference.adrLine - b.reference.adrLine
    )
}
