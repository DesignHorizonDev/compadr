// Some records keep a dated list of the states of the decision instead of one
// status: "- 2024-09-02: Drafted", "- 2024-09-09: Accepted". The latest state
// is the status of the decision.
import { normalizeStatus, type DecisionStatus } from './status.ts'

// "- 2024-09-09: Accepted", "* 2024-09-09 – Accepted", "2025-12-09: Accepted".
// Each part is set apart by a fixed character: a line is read in linear time.
const DATED_ENTRY =
  /^([ \t]*(?:[-*][ \t]+)?)(\d{4}-\d{2}-\d{2})([ \t]*[:–—-][ \t]*)(\S.*)$/
// A note between parentheses: "Edited (Added chronological status)".
const NOTE = /\([^()]*\)/g
// "Drafted & Accepted", "Edited and accepted", "Entworfen und angenommen".
const STEPS = /\s(?:&|and|et|und)\s|,/i
// "Partially superseded by ADR 0034" leaves the decision in force.
const PARTIAL = /\bpartial|\bpartiel/i

/** One line of a dated list of states. */
export interface DatedEntry {
  /** Index of the line among the lines read. */
  index: number
  /** What comes before the date: the indent and the bullet. */
  bullet: string
  date: string
  /** What sits between the date and the text: `: `, ` – `. */
  separator: string
  text: string
}

/** The latest state of a dated list, and the entry that gives it. */
export interface DatedStatus {
  status: DecisionStatus
  /** The entry as written, without its bullet: "2024-09-09: Accepted". */
  raw: string
  entries: DatedEntry[]
}

/** The state that one entry gives: the last step of the entry wins. */
function entryStatus(text: string): DecisionStatus {
  const written = text.replace(NOTE, ' ')
  if (PARTIAL.test(written)) return 'unknown'
  const steps = written.split(STEPS)
  for (let i = steps.length - 1; i >= 0; i--) {
    const status = normalizeStatus(steps[i])
    if (status !== 'unknown') return status
  }
  return 'unknown'
}

/**
 * The dated entries of `lines`, read from the first non-blank line: a list
 * that does not start with a dated line is not a dated list. Blank lines
 * between entries are allowed, and the list stops at the first other line.
 */
export function datedEntries(
  lines: readonly string[],
  { fromFirstLine }: { fromFirstLine: boolean }
): DatedEntry[] {
  const entries: DatedEntry[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (line.trim() === '') continue
    const match = DATED_ENTRY.exec(line)
    if (match === null) {
      if (fromFirstLine || entries.length > 0) break
      continue
    }
    entries.push({
      index,
      bullet: match[1]!,
      date: match[2]!,
      separator: match[3]!,
      text: match[4]!.trim(),
    })
  }
  return entries
}

/**
 * The latest state of a list of dated entries: "- 2024-09-02: Drafted",
 * "- 2024-09-09: Accepted". The latest date wins, and on the same date the
 * later line. An entry that gives no state ("Edited", "Updated") is passed
 * over. A list where no entry gives a state is unknown, and its raw status is
 * its last entry. Returns `null` for an empty list.
 */
export function readDatedStatus(entries: DatedEntry[]): DatedStatus | null {
  if (entries.length === 0) return null
  let best: { entry: DatedEntry; status: DecisionStatus } | null = null
  for (const entry of entries) {
    const status = entryStatus(entry.text)
    if (status === 'unknown') continue
    if (best === null || entry.date >= best.entry.date) best = { entry, status }
  }
  const entry = best?.entry ?? entries[entries.length - 1]!
  return {
    status: best?.status ?? 'unknown',
    raw: `${entry.date}${entry.separator}${entry.text}`,
    entries,
  }
}

/**
 * The header holds the metadata of a record: everything before the first
 * second-level section. A record without sections has no clear end of header,
 * so its header stops after the first paragraph that follows the title.
 */
export function headerOf(
  lines: readonly string[],
  bodyStart: number
): string[] {
  const section = lines.findIndex(line => line.startsWith('## '))
  if (section !== -1) return lines.slice(0, section)
  const title = lines.findIndex(
    (line, i) => i >= bodyStart && line.startsWith('# ')
  )
  let end = title === -1 ? bodyStart : title + 1
  while (end < lines.length && lines[end]!.trim() === '') end++
  while (end < lines.length && lines[end]!.trim() !== '') end++
  return lines.slice(0, end)
}

const STATUS_HEADING = /^## (?:Status|Statut)[ \t]*$/i

/** Lines of a record that may hold a dated list of states. */
export interface DatedStatusPlace {
  /** Index in the record of the first line of `lines`. */
  start: number
  lines: string[]
  /** True when the list must start on the first non-blank line. */
  fromFirstLine: boolean
}

/** The lines of the `## Status` section, without its heading. */
export function statusSectionLines(
  lines: readonly string[]
): DatedStatusPlace | null {
  const heading = lines.findIndex(line => STATUS_HEADING.test(line))
  if (heading === -1) return null
  const next = lines.findIndex(
    (line, i) => i > heading && line.startsWith('## ')
  )
  return {
    start: heading + 1,
    lines: lines.slice(heading + 1, next === -1 ? lines.length : next),
    fromFirstLine: true,
  }
}

/** The lines of the header, after the frontmatter. */
export function headerLines(
  lines: readonly string[],
  bodyStart: number
): DatedStatusPlace {
  return {
    start: bodyStart,
    lines: headerOf(lines, bodyStart).slice(bodyStart),
    fromFirstLine: false,
  }
}
