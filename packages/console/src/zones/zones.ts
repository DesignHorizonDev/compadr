// What the Coverage view reads in a report: the zones, grouped by coverage,
// and the linked files of one zone.
import {
  decisionsForFile,
  linkedPaths,
  type DriftReport,
  type Zone,
  type ZoneCoverage,
} from '@compadr/format'

export const COVERAGE_LABELS: Record<ZoneCoverage, string> = {
  strong: 'Strong',
  partial: 'Partial',
  thin: 'Thin',
  'folder-only': 'Folder only',
  none: 'None',
}

export const COVERAGE_HINTS: Record<ZoneCoverage, string> = {
  strong:
    'Half of the files are linked to a decision in force or more, and one of them both ways.',
  partial: '15 % of the files are linked to a decision in force or more.',
  thin: 'Fewer than 15 % of the files are linked to a decision in force.',
  'folder-only':
    'A record cites the folder, but no decision in force names one of its files.',
  none: 'No decision in force reaches the zone.',
}

const ORDER: Record<ZoneCoverage, number> = {
  strong: 0,
  partial: 1,
  thin: 2,
  'folder-only': 3,
  none: 4,
}

export type CoverageTab = 'covered' | 'uncovered' | 'all'

/** Zones under decisions first, by coverage then linked files; the others by size. */
export function zonesOf(report: DriftReport, tab: CoverageTab): Zone[] {
  const zones = report.zones ?? []
  const covered = zones
    .filter(zone => zone.linkedFiles > 0)
    .sort(
      (a, b) =>
        ORDER[a.coverage] - ORDER[b.coverage] ||
        b.linkedFiles - a.linkedFiles ||
        a.path.localeCompare(b.path)
    )
  const uncovered = zones
    .filter(zone => zone.linkedFiles === 0)
    .sort((a, b) => b.files - a.files || a.path.localeCompare(b.path))
  if (tab === 'covered') return covered
  if (tab === 'uncovered') return uncovered
  return [...covered, ...uncovered]
}

export const zoneName = (zone: Zone) =>
  zone.own ? `${zone.path} (own files)` : zone.path

/** A key that tells apart a folder and the zone of its own files. */
export const zoneKey = (zone: Zone) => `${zone.path}${zone.own ? '#own' : ''}`

/**
 * The files of a zone that a decision in force names, as the zone counts
 * them, with their number of such decisions.
 * A zone of its own files holds the files directly in its folder only; any
 * other zone holds every file below its folder that no inner zone holds.
 */
export function zoneFiles(
  report: DriftReport,
  zone: Zone
): { path: string; decisions: number }[] {
  const others = (report.zones ?? []).filter(
    other => other !== zone && !other.own && other.path !== zone.path
  )
  const below = (folder: string, path: string) =>
    folder === '.' || path.startsWith(`${folder}/`)
  const linked = linkedPaths(report)
  // A cited folder is among the linked paths: another one lies below it.
  const folders = new Set(
    linked.flatMap(({ path }) =>
      path
        .split('/')
        .slice(0, -1)
        .map((_, i, parts) => parts.slice(0, i + 1).join('/'))
    )
  )
  const inZone = linked.filter(({ path }) => {
    if (folders.has(path)) return false
    if (/\.(?:md|mdx|txt)$/i.test(path)) return false
    if (path.startsWith(`${report.repository.adrDir}/`)) return false
    if (zone.own) {
      const folder = path.slice(0, Math.max(0, path.lastIndexOf('/'))) || '.'
      return folder === zone.path
    }
    if (!below(zone.path, path)) return false
    // A deeper zone takes the files of its folder.
    return !others.some(
      other => other.path.length > zone.path.length && below(other.path, path)
    )
  })
  return inZone.flatMap(({ path }) => {
    const decisions = decisionsForFile(report, path).inForce.filter(
      entry => entry.scope === 'file'
    ).length
    return decisions === 0 ? [] : [{ path, decisions }]
  })
}
