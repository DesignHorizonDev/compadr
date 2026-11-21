// Zones of the code: folders of code files, with the decisions in force that
// reach them. A zone tells an agent whether the files it is about to change
// fall under decisions, and tells a team where the decisions cover the code
// most and least. Covering everything is not the aim: a zone without decision
// is information, never a problem.
import {
  decisionsForFile,
  linkedBothWays,
  linkWeight,
  worstSignals,
  type DriftReport,
  type Zone,
  type ZoneCoverage,
} from '@compadr/format'
import { isCode } from './read-corpus.ts'

const GENERIC_FOLDERS = new Set(['src', 'lib', 'app', 'packages'])

/** Share of linked files from which a zone is covered `strong` or `partial`. */
export const STRONG_SHARE = 0.5
export const PARTIAL_SHARE = 0.15

const ROOT = '.'

function parent(file: string): string {
  const slash = file.lastIndexOf('/')
  return slash === -1 ? ROOT : file.slice(0, slash)
}

/**
 * The folder where the zone of a file starts: the folders of its path up to
 * the second one that is not generic (`src`, `lib`, `app`, `packages`), as
 * `codeArea` names them, but with the real path.
 */
export function zoneRoot(file: string): string {
  const folders = file.split('/').slice(0, -1)
  let named = 0
  for (let i = 0; i < folders.length; i++) {
    if (!GENERIC_FOLDERS.has(folders[i]!)) named++
    if (named === 2) return folders.slice(0, i + 1).join('/')
  }
  return folders.length === 0 ? ROOT : folders.join('/')
}

function inside(folder: string, path: string): boolean {
  return folder === ROOT || path === folder || path.startsWith(`${folder}/`)
}

interface FileLinks {
  /** Weight of each decision in force linked to the file. */
  decisions: Map<number, number>
  crossChecked: boolean
}

function classify(
  files: number,
  linked: number,
  crossChecked: number,
  folderCited: readonly number[]
): ZoneCoverage {
  if (linked === 0) return folderCited.length > 0 ? 'folder-only' : 'none'
  const share = linked / files
  if (share >= STRONG_SHARE && crossChecked > 0) return 'strong'
  if (share >= PARTIAL_SHARE) return 'partial'
  return 'thin'
}

/**
 * The zones of the code files of a commit. A zone starts at `zoneRoot`. When
 * two of its subfolders or more hold linked files, each subfolder becomes a
 * zone, and the folder keeps its own files in a zone of its own (`own`).
 */
export function computeZones(
  report: DriftReport,
  trackedFiles: Iterable<string>
): Zone[] {
  const adrDir = `${report.repository.adrDir}/`
  const files = [...trackedFiles].filter(
    file => isCode(file) && !file.startsWith(adrDir)
  )
  const signals = worstSignals(report)
  const links = new Map<string, FileLinks>()
  for (const file of files) {
    const answer = decisionsForFile(report, file)
    const decisions = new Map<number, number>()
    let crossChecked = false
    for (const entry of answer.inForce) {
      if (entry.scope !== 'file') continue
      decisions.set(entry.decision, linkWeight(entry, file, signals))
      if (linkedBothWays(entry.links, file)) crossChecked = true
    }
    if (decisions.size > 0) links.set(file, { decisions, crossChecked })
  }

  // Folders that a decision in force cites, by decision.
  const inForce = new Set(
    report.decisions.filter(d => d.status === 'accepted').map(d => d.number)
  )
  const citedFolders: { folder: string; decision: number }[] = []
  const fileSet = new Set(trackedFiles)
  for (const reference of report.references) {
    if (reference.kind !== 'path' || !inForce.has(reference.decision)) continue
    for (const path of reference.resolvedPaths) {
      if (!fileSet.has(path) && !path.startsWith(adrDir)) {
        citedFolders.push({ folder: path, decision: reference.decision })
      }
    }
  }

  const zone = (path: string, own: boolean, members: string[]): Zone => {
    const weights = new Map<number, number>()
    let linked = 0
    let crossChecked = 0
    for (const file of members) {
      const found = links.get(file)
      if (found === undefined) continue
      linked++
      if (found.crossChecked) crossChecked++
      for (const [decision, weight] of found.decisions) {
        weights.set(decision, (weights.get(decision) ?? 0) + weight)
      }
    }
    // A cited folder marks the zone that holds its files: the folder of the
    // zone, or a folder inside it. A folder cited above the zone says nothing
    // about it in particular, and one inside another zone marks that zone.
    const folderCited = [
      ...new Set(
        citedFolders
          .filter(
            ({ folder }) =>
              folder === path ||
              (inside(path, folder) &&
                members.some(file => file.startsWith(`${folder}/`)))
          )
          .map(({ decision }) => decision)
      ),
    ].sort((a, b) => a - b)
    const decisions = [...weights]
      .map(([number, weight]) => ({
        number,
        weight: Math.round(weight * 10) / 10,
      }))
      .sort((a, b) => b.weight - a.weight || a.number - b.number)
    return {
      path,
      own,
      files: members.length,
      linkedFiles: linked,
      crossChecked,
      weight:
        Math.round(decisions.reduce((sum, d) => sum + d.weight, 0) * 10) / 10,
      decisions,
      folderCited,
      coverage: classify(members.length, linked, crossChecked, folderCited),
    }
  }

  const groups = new Map<string, string[]>()
  for (const file of files) {
    const root = zoneRoot(file)
    groups.set(root, [...(groups.get(root) ?? []), file])
  }
  const zones: Zone[] = []
  for (const [root, members] of groups) {
    const children = new Map<string, string[]>()
    const direct: string[] = []
    for (const file of members) {
      const folder = parent(file)
      if (folder === root) {
        direct.push(file)
        continue
      }
      const rest = file.slice(root === ROOT ? 0 : root.length + 1)
      const child =
        root === ROOT ? rest.split('/')[0]! : `${root}/${rest.split('/')[0]!}`
      children.set(child, [...(children.get(child) ?? []), file])
    }
    const linkedChildren = [...children.values()].filter(group =>
      group.some(file => links.has(file))
    )
    if (linkedChildren.length < 2) {
      zones.push(zone(root, false, members))
      continue
    }
    for (const [child, group] of children) zones.push(zone(child, false, group))
    if (direct.length > 0) zones.push(zone(root, true, direct))
  }
  return zones.sort(
    (a, b) => a.path.localeCompare(b.path) || Number(a.own) - Number(b.own)
  )
}
