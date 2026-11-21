import { parse as parseYaml } from 'yaml'
import { findAdrNumbers } from './adr-reference.ts'
import { readAnchors, type RecordedAnchor } from './anchor.ts'
import { parseAdrFileName } from './adr-file.ts'
import { AMENDED_BY, AMENDS } from './relation-words.ts'
import { normalizeStatus, type DecisionStatus } from './status.ts'

/** What Compadr reads in one decision record, before looking at the code. */
export interface AdrDocument {
  number: number
  slug: string
  title: string
  /** Status as written in the file. */
  rawStatus: string
  status: DecisionStatus
  /** Date declared in the file (YYYY-MM-DD). */
  date: string | null
  /** Older decisions that this one amends. */
  amends: number[]
  /** Newer decisions that amend this one, as declared in this file. */
  amendedBy: number[]
  /** Decisions named in the status of a superseded record. */
  supersededBy: number[]
  /** Every other decision cited anywhere in the text. */
  mentions: number[]
  /** `compadr.feature`: the feature the decision belongs to. */
  feature: string | null
  /** `compadr.parent`: the main decision of a detail decision. */
  parent: number | null
  /** `compadr.anchors`, keyed by the anchored reference (`path#Symbol`). */
  anchors: Record<string, RecordedAnchor>
  /** `compadr.checked`: when a person checked each reference, by its text. */
  checked: Record<string, CheckedEntry>
  /**
   * People who made the decision, as the record names them: `decision-makers`
   * in the frontmatter (MADR), or a `Deciders:` line of the header (MADR 2,
   * Log4brains).
   */
  deciders: string[]
  /** `compadr.rule`: what the decision requires, in one sentence. */
  rule: string | null
  /** Number of lines of the file. */
  lineCount: number
}

/** One entry of `compadr.checked`. */
export interface CheckedEntry {
  /** UTC date and time of the commit that was checked. */
  at: string
  /** The person who checked, when the entry names one. */
  by: string | null
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/
// "Status: accepted", "- **Status:** Accepted", "- **Statut** : acceptée". The
// colon is required, and the value stays on the same line.
const STATUS_LINE =
  /^[ \t]*(?:[-*][ \t]+)?\**(?:Status|Statut)\**[ \t]*:[ \t]*\**[ \t]*(\S.*)$/im
const STATUS_SECTION =
  /^## (?:Status|Statut)[ \t]*\n(?:[ \t]*\n)*[ \t]*(\S.*)$/im
const DATE_LINE =
  /^[ \t]*(?:[-*][ \t]+)?\**Date\**[ \t]*:[ \t]*\**[ \t]*(\d{4}-\d{2}-\d{2})/im
// "- Deciders: Ana, Bo", "* **Decision-makers:** Ana", "- **Décideurs** : Ana".
const DECIDERS_LINE =
  /^[ \t]*(?:[-*][ \t]+)?\**(?:Deciders|Decision[- ]makers|Décideurs|Décideuses)\**[ \t]*:[ \t]*\**[ \t]*(\S.*)$/im
const FRONTMATTER_STATUS = /^status:\s*(.+)$/m
const FRONTMATTER_DATE = /^date:\s*(\d{4}-\d{2}-\d{2})/m
// "# ADR-0012 — Title", "# ADR 12 Title", "# 12. Title", "# 0012 : Title". A
// number without the ADR prefix needs a separator: "# 2FA for admins" keeps
// its digits.
const TITLE_PREFIX =
  /^(?:ADR[- ]?\d{1,4}(?:\s*[.:—–]|\s+-)?|\d{1,4}(?:\s*[.:—–]|\s+-))\s*/i

interface Frontmatter {
  status: string | null
  date: string | null
  feature: string | null
  parent: number | null
  anchors: Record<string, RecordedAnchor>
  checked: Record<string, CheckedEntry>
  deciders: string[]
  rule: string | null
}

function readDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null
  }
  return null
}

// 2026-11-04T09:12:00Z, or with an offset: 2026-11-04T10:12:00+01:00.
const CHECKED_AT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** Names of a list of people: a YAML list, or one text split on commas. */
export function readNames(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value.filter(item => typeof item === 'string')
    : typeof value === 'string'
      ? value.split(/[,;]/)
      : []
  return [
    ...new Set(
      items.map(name => name.replace(/\*+/g, '').trim()).filter(Boolean)
    ),
  ]
}

function readCheckedAt(at: unknown): string | null {
  const date =
    at instanceof Date
      ? at
      : typeof at === 'string' && CHECKED_AT.test(at)
        ? new Date(at)
        : null
  return date !== null && !Number.isNaN(date.getTime())
    ? `${date.toISOString().slice(0, 19)}Z`
    : null
}

/**
 * `compadr.checked`: the reference as the record cites it, and the UTC date
 * and time of the commit at which a person checked it against the code. An
 * entry is that date, or a map of the date (`at`) and the person (`by`). An
 * entry without such a date is left out.
 */
function readChecked(value: unknown): Record<string, CheckedEntry> {
  const entries = asRecord(value)
  if (entries === null) return {}
  const checked: [string, CheckedEntry][] = []
  for (const [text, entry] of Object.entries(entries)) {
    // A date alone, or a map with the date and the person who checked.
    const fields = asRecord(entry)
    const at = readCheckedAt(fields === null ? entry : fields.at)
    if (at === null) continue
    const by =
      typeof fields?.by === 'string' && fields.by.trim() !== ''
        ? fields.by.trim()
        : null
    checked.push([text, { at, by }])
  }
  // fromEntries defines each key, `__proto__` included, as a plain property.
  return Object.fromEntries(checked)
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d{1,4}$/.test(value.trim())) {
    return Number(value.trim())
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readFrontmatter(source: string): Frontmatter {
  let data: Record<string, unknown> | null = null
  try {
    data = asRecord(parseYaml(source))
  } catch {
    // The parser is tolerant: invalid YAML falls back to a line search below.
  }
  if (data === null) {
    return {
      status: FRONTMATTER_STATUS.exec(source)?.[1]?.trim() ?? null,
      date: FRONTMATTER_DATE.exec(source)?.[1] ?? null,
      feature: null,
      parent: null,
      anchors: {},
      checked: {},
      deciders: [],
      rule: null,
    }
  }
  const compadr = asRecord(data.compadr)
  return {
    status:
      typeof data.status === 'string' && data.status.trim() !== ''
        ? data.status.trim()
        : null,
    date: readDate(data.date),
    feature:
      typeof compadr?.feature === 'string' && compadr.feature.trim() !== ''
        ? compadr.feature.trim()
        : null,
    parent: readNumber(compadr?.parent),
    anchors: readAnchors(compadr?.anchors),
    checked: readChecked(compadr?.checked),
    deciders: readNames(data['decision-makers']),
    rule:
      typeof compadr?.rule === 'string' && compadr.rule.trim() !== ''
        ? compadr.rule.trim().replace(/\s+/g, ' ')
        : null,
  }
}

function sortedUnique(numbers: Iterable<number>, without: number): number[] {
  return [...new Set(numbers)].filter(n => n !== without).sort((a, b) => a - b)
}

/**
 * The header holds the metadata of a record: everything before the first
 * second-level section. A record without sections has no clear end of header,
 * so its header stops after the first paragraph that follows the title.
 */
function headerOf(lines: readonly string[], bodyStart: number): string[] {
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

// A heading that records an amendment: "## Amendment (2026-10-10)",
// "## Amendement du lot J4", "## What this amends", "## Ce que cela amende".
const AMENDMENT_HEADING =
  /^(#{2,6})\s+.*\b(?:amendments?|amendements?|amends?|amende)\b/i

/**
 * Decisions that the amendment sections of a record name. Records are
 * numbered in order, so a newer decision named there amends this one, and an
 * older one is amended by it.
 */
function amendmentSections(
  lines: readonly string[],
  number: number
): { amends: number[]; amendedBy: number[] } {
  const amends: number[] = []
  const amendedBy: number[] = []
  let level = 0
  let fence: string | null = null
  for (const line of lines) {
    // A line of a code block is never a heading: `# ADR-0003` can be a
    // comment of a shell example.
    const marker = /^\s*(```|~~~)/.exec(line)?.[1]
    if (marker !== undefined && (fence === null || fence === marker)) {
      fence = fence === null ? marker : null
    }
    const heading =
      fence === null && marker === undefined ? /^(#{1,6})\s/.exec(line) : null
    if (heading !== null) {
      const amendment = AMENDMENT_HEADING.exec(line)
      if (amendment !== null) level = amendment[1]!.length
      else if (heading[1]!.length <= level) level = 0
      continue
    }
    if (level === 0) continue
    for (const named of findAdrNumbers(line)) {
      if (named > number) amendedBy.push(named)
      else if (named < number) amends.push(named)
    }
  }
  return { amends, amendedBy }
}

/** Number of lines, counted like `wc -l` plus a last line without newline. */
function countLines(text: string): number {
  if (text === '') return 0
  const newlines = text.split('\n').length - 1
  return text.endsWith('\n') ? newlines : newlines + 1
}

/**
 * Reads a decision record written with adr-tools, MADR or Log4brains, in
 * English or in French. Returns `null` when the file name does not follow the
 * `NNNN-title.md` convention.
 *
 * The status and the date are read from the YAML frontmatter, then from a
 * `Status:` line of the header, then from a `## Status` section.
 */
export function parseAdr(path: string, content: string): AdrDocument | null {
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  const name = parseAdrFileName(fileName)
  if (name === null) return null

  const text = content.replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const frontmatterMatch = FRONTMATTER.exec(text)
  const frontmatter =
    frontmatterMatch === null ? null : readFrontmatter(frontmatterMatch[1]!)
  // First line after the frontmatter: a YAML comment is not a title.
  const bodyStart =
    frontmatterMatch === null
      ? 0
      : frontmatterMatch[0].replace(/\n$/, '').split('\n').length
  const header = headerOf(lines, bodyStart).join('\n')

  const rawStatus = (
    frontmatter?.status ??
    STATUS_LINE.exec(header)?.[1] ??
    STATUS_SECTION.exec(text)?.[1] ??
    ''
  ).trim()
  const status = normalizeStatus(rawStatus)
  const date = frontmatter?.date ?? DATE_LINE.exec(header)?.[1] ?? null

  const titleLine = lines.slice(bodyStart).find(line => line.startsWith('# '))
  const title =
    titleLine === undefined
      ? fileName
      : titleLine.slice(2).trim().replace(TITLE_PREFIX, '') || fileName

  // "Amends ADR-0023": this decision changes 0023. "Amended by ADR-0034":
  // 0034 changes this decision. A status line counts like any header line:
  // "Status: Accepted, amends ADR-0003" is a link to 0003.
  const amends: number[] = []
  const amendedBy: number[] = []
  for (const line of header.split('\n')) {
    const passive = AMENDED_BY.test(line)
    if (!passive && !AMENDS.test(line)) continue
    const numbers = findAdrNumbers(line)
    if (passive) amendedBy.push(...numbers)
    else amends.push(...numbers)
  }
  const sections = amendmentSections(lines.slice(bodyStart), name.number)
  amends.push(...sections.amends)
  amendedBy.push(...sections.amendedBy)

  return {
    number: name.number,
    slug: name.slug,
    title,
    rawStatus,
    status,
    date,
    amends: sortedUnique(amends, name.number),
    amendedBy: sortedUnique(amendedBy, name.number),
    supersededBy:
      status === 'superseded'
        ? sortedUnique(findAdrNumbers(rawStatus), name.number)
        : [],
    mentions: sortedUnique(findAdrNumbers(text), name.number),
    feature: frontmatter?.feature ?? null,
    parent: frontmatter?.parent ?? null,
    anchors: frontmatter?.anchors ?? {},
    checked: frontmatter?.checked ?? {},
    deciders:
      frontmatter !== null && frontmatter.deciders.length > 0
        ? frontmatter.deciders
        : readNames(DECIDERS_LINE.exec(header)?.[1] ?? ''),
    rule: frontmatter?.rule ?? null,
    lineCount: countLines(text),
  }
}
