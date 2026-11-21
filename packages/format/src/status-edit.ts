// Changes the status of a proposed decision record to accepted, where the
// record writes it, and keeps the rest of the record as written. A person
// accepts a decision: this edit only writes what they chose.
import { normalizeStatus } from './status.ts'

export class StatusEditError extends Error {}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const FRONTMATTER_STATUS = /^(status:[ \t]*)(.+?)[ \t]*$/m
// The same lines as the parser reads, with the part before the value kept.
const STATUS_LINE =
  /^([ \t]*(?:[-*][ \t]+)?\**(?:Status|Statut)\**[ \t]*:[ \t]*(?:\*+[ \t]*)?)(\S.*)$/im
const STATUS_SECTION =
  /^(## (?:Status|Statut)[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*)(\S.*)$/im

/**
 * A value and what closes it: its trailing spaces, and with `stars` the stars
 * before them (`proposed**  ` → `proposed`, `**  `). The value keeps its first
 * character. Read by hand: a lazy value followed by a trailing run takes
 * quadratic time on a long run.
 */
function splitTrailing(
  value: string,
  stars: boolean
): { value: string; after: string } {
  const isSpace = (char: string | undefined) => char === ' ' || char === '\t'
  let end = value.length
  while (end > 1 && isSpace(value[end - 1])) end--
  if (stars) while (end > 1 && value[end - 1] === '*') end--
  return { value: value.slice(0, end), after: value.slice(end) }
}
const SECTION = /^## /m

function checkProposed(value: string): void {
  const status = normalizeStatus(value)
  if (status !== 'proposed') {
    throw new StatusEditError(`the record is ${status}, not proposed`)
  }
}

/** "Accepted (2026-11-17)", or "acceptée (2026-11-17)" in a French record. */
function acceptedValue(old: string, french: boolean, date: string): string {
  const word = french ? 'acceptée' : 'accepted'
  const first = old.charAt(0)
  const cased =
    first !== first.toLowerCase()
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word
  return `${cased} (${date})`
}

/**
 * The record with its status changed to accepted on `date`
 * (YYYY-MM-DD): in the YAML frontmatter, else in a `Status:` line of the
 * header, else in a `## Status` section, as the parser reads it. Throws a
 * StatusEditError when the record has no status, or is not proposed.
 */
export function acceptRecordStatus(markdown: string, date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new StatusEditError(`${date} is not a date`)
  }
  const frontmatter = FRONTMATTER.exec(markdown)
  if (frontmatter !== null) {
    const status = FRONTMATTER_STATUS.exec(frontmatter[1]!)
    if (status !== null) {
      checkProposed(status[2]!.replace(/^["']|["']$/g, ''))
      // Cut by position: a `$` of the record is never a replacement pattern.
      const at = frontmatter.index + frontmatter[0].indexOf(frontmatter[1]!)
      const from = at + status.index + status[1]!.length
      return (
        markdown.slice(0, from) +
        'accepted' +
        markdown.slice(from + status[2]!.length)
      )
    }
  }
  const start = frontmatter === null ? 0 : frontmatter[0].length
  const section = SECTION.exec(markdown.slice(start))
  const end = section === null ? markdown.length : start + section.index
  const header = markdown.slice(start, end)
  const line = STATUS_LINE.exec(header)
  if (line !== null) {
    const [whole, before, rest] = line as unknown as [string, string, string]
    const { value, after } = splitTrailing(rest, true)
    checkProposed(value)
    const french = /statut/i.test(before) || /proposée/i.test(value)
    const replaced = `${before}${acceptedValue(value, french, date)}${after}`
    return (
      markdown.slice(0, start + line.index) +
      replaced +
      markdown.slice(start + line.index + whole.length)
    )
  }
  const sectionStatus = STATUS_SECTION.exec(markdown)
  if (sectionStatus !== null) {
    const [whole, before, rest] = sectionStatus as unknown as [
      string,
      string,
      string,
    ]
    const { value, after } = splitTrailing(rest, false)
    checkProposed(value)
    const french = /statut/i.test(before) || /proposée/i.test(value)
    return (
      markdown.slice(0, sectionStatus.index) +
      `${before}${acceptedValue(value, french, date)}${after}` +
      markdown.slice(sectionStatus.index + whole.length)
    )
  }
  throw new StatusEditError('the record writes no status')
}
