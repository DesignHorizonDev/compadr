// `compadr coverage`: the zones of the code and how much the decisions in
// force reach them, as text.
import type { DriftReport, Zone, ZoneCoverage } from '@compadr/format'

const label = (n: number) => `ADR-${String(n).padStart(4, '0')}`

const ORDER: Record<ZoneCoverage, number> = {
  strong: 0,
  partial: 1,
  thin: 2,
  'folder-only': 3,
  none: 4,
}

/** Decisions listed on the line of a zone; the others are counted. */
const SHOWN_DECISIONS = 6
/** Zones without decision listed at the end, the largest first. */
const SHOWN_UNCOVERED = 10

const name = (zone: Zone) => (zone.own ? `${zone.path} (own files)` : zone.path)

function decisions(zone: Zone): string {
  const shown = zone.decisions
    .slice(0, SHOWN_DECISIONS)
    .map(d => label(d.number))
  const more = zone.decisions.length - shown.length
  return [...shown, ...(more > 0 ? [`+${more}`] : [])].join(' ')
}

/** Lines of the answer: a summary, the zones under decisions, the largest without. */
export function formatCoverage(report: DriftReport): string[] {
  const zones = report.zones ?? []
  const count = (coverage: ZoneCoverage) =>
    zones.filter(zone => zone.coverage === coverage).length
  const lines = [
    `Coverage of the code by the decisions in force (${report.repository.name}, commit ${report.repository.commit.slice(0, 8)})`,
    `${zones.length} zones: ${(Object.keys(ORDER) as ZoneCoverage[]).map(c => `${count(c)} ${c}`).join(', ')}`,
  ]
  const covered = zones
    .filter(zone => zone.linkedFiles > 0)
    .sort(
      (a, b) =>
        ORDER[a.coverage] - ORDER[b.coverage] ||
        b.linkedFiles - a.linkedFiles ||
        a.path.localeCompare(b.path)
    )
  if (covered.length > 0) {
    lines.push('', 'Zones under decisions:')
    const width = Math.max(...covered.map(zone => name(zone).length))
    for (const zone of covered) {
      lines.push(
        `  ${zone.coverage.padEnd(8)} ${name(zone).padEnd(width)}  ${zone.linkedFiles}/${zone.files} files, ${zone.crossChecked} cross-checked  ${decisions(zone)}`
      )
    }
  }
  const uncovered = zones
    .filter(zone => zone.linkedFiles === 0)
    .sort((a, b) => b.files - a.files || a.path.localeCompare(b.path))
    .slice(0, SHOWN_UNCOVERED)
  if (uncovered.length > 0) {
    lines.push('', 'Largest zones without a decision on their files:')
    const width = Math.max(...uncovered.map(zone => name(zone).length))
    for (const zone of uncovered) {
      const cited =
        zone.folderCited.length > 0
          ? `  folder cited by ${zone.folderCited.map(label).join(' ')}`
          : ''
      lines.push(
        `  ${zone.coverage.padEnd(11)} ${name(zone).padEnd(width)}  ${zone.files} files${cited}`
      )
    }
  }
  return lines
}
