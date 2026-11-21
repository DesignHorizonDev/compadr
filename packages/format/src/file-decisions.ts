// The decisions that apply to a file of the repository, read from a drift
// report. A decision applies to a file when its record cites the file or a
// folder that holds it, when its record cites a symbol that the file alone
// declares, or when the file cites the decision. The links keep their source.
import type { Decision, DriftReport } from './report-schema.ts'
import type { DecisionStatus } from './status.ts'

export type FileLink =
  | {
      /** The record cites the file, or a folder that holds it. */
      source: 'record-cites-path'
      /** Decision whose record holds the reference. */
      decision: number
      reference: string
      text: string
      /** Cited path: the file itself or one of its folders. */
      path: string
      lines: { start: number; end: number } | null
      /** Symbol of an anchored reference (`path#Symbol`). */
      symbol: string | null
      citedAt: string | null
    }
  | {
      /** The record cites a symbol that this file alone declares. */
      source: 'record-cites-symbol'
      decision: number
      reference: string
      symbol: string
      /** Line of the declaration in the file. */
      line: number
      citedAt: string | null
    }
  | {
      /** The file cites the decision, in a comment or a string. */
      source: 'file-cites-record'
      decision: number
      line: number
    }

export type FileDecisionRole = 'in-force' | 'context' | 'out-of-force'

export interface FileDecision {
  decision: number
  title: string
  status: DecisionStatus
  role: FileDecisionRole
  /**
   * `file` when a link names the file itself; `folder` when the decision
   * reaches the file through a cited folder only, which says less about it.
   */
  scope: 'file' | 'folder'
  /** Superseded decisions whose links lead to this one. */
  replaces: number[]
  links: FileLink[]
}

export interface FileDecisions {
  path: string
  /** Accepted decisions, and the successors of superseded ones. */
  inForce: FileDecision[]
  /** Proposed decisions, and decisions whose status is unknown. */
  context: FileDecision[]
  /** Rejected and deprecated decisions, and superseded ones without a known successor. */
  outOfForce: FileDecision[]
}

/** `./src//a.ts/` → `src/a.ts`. */
export function normalizeRepositoryPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '')
}

function covers(cited: string, path: string): boolean {
  return cited === path || path.startsWith(`${cited}/`)
}

/** Every link between the decisions and `path`, by decision. */
function linksTo(report: DriftReport, path: string): Map<number, FileLink[]> {
  const links = new Map<number, FileLink[]>()
  const add = (link: FileLink) =>
    links.set(link.decision, [...(links.get(link.decision) ?? []), link])
  for (const reference of report.references) {
    if (reference.kind === 'symbol') {
      // A symbol declared in several files says nothing about any of them.
      const declared = reference.declaredIn ?? []
      if (declared.length === 1 && declared[0]!.file === path) {
        add({
          source: 'record-cites-symbol',
          decision: reference.decision,
          reference: reference.id,
          symbol: reference.symbol,
          line: declared[0]!.line,
          citedAt: reference.citedAt,
        })
      }
      continue
    }
    const cited = reference.resolvedPaths.find(p => covers(p, path))
    if (cited === undefined) continue
    add({
      source: 'record-cites-path',
      decision: reference.decision,
      reference: reference.id,
      text: reference.text,
      path: cited,
      lines: cited === path ? reference.lines : null,
      symbol: reference.anchor?.symbol ?? null,
      citedAt: reference.citedAt,
    })
  }
  for (const citation of report.citations) {
    if (citation.file === path) {
      add({
        source: 'file-cites-record',
        decision: citation.decision,
        line: citation.line,
      })
    }
  }
  return links
}

function roleOf(status: DecisionStatus): FileDecisionRole {
  if (status === 'accepted') return 'in-force'
  if (status === 'proposed' || status === 'unknown') return 'context'
  return 'out-of-force'
}

/**
 * The decisions a superseded decision leads to: its successors, followed
 * until a decision that is not superseded. Empty when no successor is known.
 */
function successors(
  decision: Decision,
  decisions: ReadonlyMap<number, Decision>,
  seen = new Set<number>()
): Decision[] {
  seen.add(decision.number)
  const found = decision.supersededBy.flatMap(number => {
    const next = decisions.get(number)
    if (next === undefined || seen.has(number)) return []
    return next.status === 'superseded'
      ? successors(next, decisions, seen)
      : [next]
  })
  // Two replaced decisions can lead to the same successor.
  return [...new Map(found.map(d => [d.number, d])).values()]
}

/** A link that names the file itself, not one of its folders. */
export function namesFile(link: FileLink, path: string): boolean {
  return link.source !== 'record-cites-path' || link.path === path
}

/**
 * True when the links name the file both ways: the file cites the decision,
 * and its record cites the file or a symbol that the file declares.
 */
export function linkedBothWays(
  links: readonly FileLink[],
  path: string
): boolean {
  const own = links.filter(link => namesFile(link, path))
  return (
    own.some(link => link.source === 'file-cites-record') &&
    own.some(link => link.source !== 'file-cites-record')
  )
}

function bothWays(entry: FileDecision, path: string): boolean {
  return linkedBothWays(entry.links, path)
}

/** Depth of the deepest folder cited: `a/b` is deeper than `a`. */
function folderDepth(entry: FileDecision): number {
  return Math.max(
    0,
    ...entry.links.map(link =>
      link.source === 'record-cites-path' ? link.path.split('/').length : 0
    )
  )
}

/**
 * The file itself first, then both directions, then the most links that
 * name the file, then the deepest folder, then the number.
 */
function byStrength(path: string) {
  const fileLinks = (entry: FileDecision) =>
    entry.links.filter(link => namesFile(link, path)).length
  return (a: FileDecision, b: FileDecision) =>
    Number(b.scope === 'file') - Number(a.scope === 'file') ||
    Number(bothWays(b, path)) - Number(bothWays(a, path)) ||
    fileLinks(b) - fileLinks(a) ||
    folderDepth(b) - folderDepth(a) ||
    a.decision - b.decision
}

/**
 * The decisions that apply to `path`, as the report links them. A superseded
 * decision leads to the decisions that replace it, with its links.
 */
export function decisionsForFile(
  report: DriftReport,
  path: string
): FileDecisions {
  const target = normalizeRepositoryPath(path)
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  const entries = new Map<number, FileDecision>()
  const entry = (decision: Decision, role: FileDecisionRole) => {
    const existing = entries.get(decision.number)
    if (existing) return existing
    const created: FileDecision = {
      decision: decision.number,
      title: decision.title,
      status: decision.status,
      role,
      scope: 'folder',
      replaces: [],
      links: [],
    }
    entries.set(decision.number, created)
    return created
  }

  for (const [number, links] of linksTo(report, target)) {
    const decision = decisions.get(number)
    if (decision === undefined) continue
    const next =
      decision.status === 'superseded' ? successors(decision, decisions) : []
    if (next.length === 0) {
      entry(decision, roleOf(decision.status)).links.push(...links)
      continue
    }
    for (const successor of next) {
      const into = entry(successor, roleOf(successor.status))
      into.replaces.push(number)
      into.links.push(...links)
    }
  }

  for (const found of entries.values()) {
    if (found.links.some(link => namesFile(link, target))) found.scope = 'file'
  }
  const all = [...entries.values()].sort(byStrength(target))
  return {
    path: target,
    inForce: all.filter(e => e.role === 'in-force'),
    context: all.filter(e => e.role === 'context'),
    outOfForce: all.filter(e => e.role === 'out-of-force'),
  }
}

/** The paths that the report links to a decision, with their number of decisions. */
export function linkedPaths(
  report: DriftReport
): { path: string; decisions: number }[] {
  const decisions = new Map<string, Set<number>>()
  const add = (path: string, decision: number) =>
    decisions.set(path, (decisions.get(path) ?? new Set()).add(decision))
  for (const reference of report.references) {
    if (reference.kind !== 'path') continue
    for (const path of reference.resolvedPaths) add(path, reference.decision)
  }
  for (const citation of report.citations) add(citation.file, citation.decision)
  return [...decisions]
    .map(([path, set]) => ({ path, decisions: set.size }))
    .sort((a, b) => a.path.localeCompare(b.path))
}
