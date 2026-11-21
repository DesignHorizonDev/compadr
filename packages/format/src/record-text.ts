// The parts of a decision record that make up the rules in force of a
// feature: the header lines that link it to older decisions, the subsections
// of its decision, and the rules of older decisions that it replaces.
import { findAdrNumbers } from './adr-reference.ts'
import { AMENDED_BY, AMENDS, REPLACES } from './relation-words.ts'

export interface DecisionSection {
  /** Heading of the subsection, or null for the text before the first one. */
  heading: string | null
  /** Line of the record (1-based) where the subsection starts. */
  line: number
  markdown: string
}

/** A rule of an older decision, quoted by the decision that replaces it. */
export interface QuotedRule {
  quote: string
  /** Decisions named before the quote, where the rule is looked for. */
  decisions: number[]
}

export interface RecordText {
  /** Header items that link the decision to older ones, as Markdown. */
  relations: string[]
  /** Subsections of the `Decision` section, in order. */
  sections: DecisionSection[]
  replaces: QuotedRule[]
}

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/
// "## Decision", "## Décision", "## Decision Outcome" (MADR), but not
// "## Decision Drivers", which comes before the options in MADR.
const DECISION_HEADING =
  /^##[ \t]+(?:d[ée]cisions?|decision outcome)[ \t]*:?[ \t]*$/i
const FENCE = /^[ \t]*(?:```|~~~)/
const LIST_ITEM = /^(?:[-*+]|\d+[.)])[ \t]+/
const STATUS_OR_DATE = /^(?:[-*][ \t]+)?\**(?:status|statut|date)\**[ \t]*:/i
// «Rule», “rule” or "rule". A French quote keeps its inner spaces.
const QUOTE = /«\s*([^»]+?)\s*»|“([^”]+)”|"([^"\n]+)"/g

const MIN_RULE_WORDS = 4

function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]!.trim() === '') start++
  while (end > start && lines[end - 1]!.trim() === '') end--
  return lines.slice(start, end)
}

/** The items of a header: list items with their nested lines, or paragraphs. */
function headerItems(lines: readonly string[]): string[] {
  const items: string[][] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (line.trim() === '') {
      // A blank line ends a paragraph, not a list item.
      if (current !== null && !LIST_ITEM.test(current[0]!)) current = null
      continue
    }
    const topLevel = !/^\s/.test(line)
    // A status or date line stands alone, even without a blank line around.
    const alone =
      STATUS_OR_DATE.test(line) ||
      (current !== null && STATUS_OR_DATE.test(current[0]!))
    if (topLevel && (LIST_ITEM.test(line) || current === null || alone)) {
      current = [line]
      items.push(current)
    } else if (current === null) {
      current = [line]
      items.push(current)
    } else {
      current.push(line)
    }
  }
  return items.map(item =>
    [item[0]!.replace(LIST_ITEM, ''), ...item.slice(1)].join('\n')
  )
}

function quotedRules(item: string): QuotedRule[] {
  const rules: QuotedRule[] = []
  let offset = 0
  for (const line of item.split('\n')) {
    for (const match of line.matchAll(QUOTE)) {
      const before = item.slice(0, offset + match.index)
      const quote = (match[1] ?? match[2] ?? match[3]!).trim()
      // A quote of a few words names a term or a section, not a rule.
      if (
        !REPLACES.test(before) ||
        quote.split(/\s+/).length < MIN_RULE_WORDS
      ) {
        continue
      }
      const inLine = findAdrNumbers(line.slice(0, match.index))
      rules.push({
        quote,
        decisions: [
          ...new Set(inLine.length > 0 ? inLine : findAdrNumbers(before)),
        ],
      })
    }
    offset += line.length + 1
  }
  return rules
}

/** Reads the relations and the decision of a record. */
export function readDecisionText(content: string): RecordText {
  const text = content.replace(/\r\n?/g, '\n').normalize('NFC')
  const frontmatter = FRONTMATTER.exec(text)
  const lines = text.split('\n')
  // Lines inside a fenced code block, where `#` starts no heading.
  const inCode: boolean[] = []
  let fenced = false
  for (const line of lines) {
    const fence = FENCE.test(line)
    inCode.push(fenced || fence)
    if (fence) fenced = !fenced
  }
  const isHeading = (i: number, prefix: RegExp) =>
    !inCode[i] && prefix.test(lines[i]!)
  const bodyStart =
    frontmatter === null
      ? 0
      : frontmatter[0].replace(/\n$/, '').split('\n').length
  const title = lines.findIndex(
    (line, i) => i >= bodyStart && line.startsWith('# ')
  )
  const headerStart = title === -1 ? bodyStart : title + 1
  let firstSection = lines.findIndex(
    (_, i) => i >= headerStart && isHeading(i, /^## /)
  )
  if (firstSection === -1) firstSection = lines.length

  const relations = headerItems(lines.slice(headerStart, firstSection)).filter(
    item =>
      !STATUS_OR_DATE.test(item) &&
      findAdrNumbers(item).length > 0 &&
      (AMENDS.test(item) || AMENDED_BY.test(item))
  )

  const sections: DecisionSection[] = []
  const start = lines.findIndex(
    (_, i) => i >= headerStart && isHeading(i, DECISION_HEADING)
  )
  if (start !== -1) {
    let end = lines.findIndex(
      (_, i) => i > start && isHeading(i, /^#{1,2}[ \t]/)
    )
    if (end === -1) end = lines.length
    let heading: string | null = null
    let from = start + 1
    const flush = (to: number) => {
      const body = trimBlankLines(lines.slice(from, to))
      if (heading !== null || body.length > 0) {
        // The line of the heading, or the first line of the text before it.
        let first = from
        while (heading === null && lines[first]!.trim() === '') first++
        sections.push({
          heading,
          line: heading === null ? first + 1 : from,
          markdown: body.join('\n'),
        })
      }
    }
    for (let i = start + 1; i < end; i++) {
      if (isHeading(i, /^### /)) {
        flush(i)
        heading = lines[i]!.slice(4).trim()
        from = i + 1
      }
    }
    flush(end)
  }

  return {
    relations,
    sections,
    replaces: relations.flatMap(quotedRules),
  }
}

// What the search ignores: emphasis and code marks, punctuation, and text in
// parentheses, which a quote often leaves out. Apostrophes and spaces of every
// kind compare equal, and case does not count.
const IGNORED = /[*`.;:,!?]/
const APOSTROPHES = /[’ʼ‘]/
const SPACES = /\s/

interface Folded {
  text: string
  /** Offset in the source of each character of `text`. */
  offsets: number[]
}

function fold(source: string): Folded {
  let text = ''
  const offsets: number[] = []
  let depth = 0
  for (let i = 0; i < source.length; i++) {
    let char = source[i]!
    if (char === '(') depth++
    if (depth > 0) {
      if (char === ')') depth--
      continue
    }
    if (IGNORED.test(char)) continue
    if (SPACES.test(char)) {
      if (text.endsWith(' ') || text === '') continue
      char = ' '
    } else if (APOSTROPHES.test(char)) {
      char = "'"
    } else {
      // A lowercase letter keeps the length of its uppercase form in the
      // alphabets of the records; any other case keeps the original.
      const lower = char.toLowerCase()
      if (lower.length === 1) char = lower
    }
    text += char
    offsets.push(i)
  }
  return { text, offsets }
}

// "[…]", "[...]" or "…" between two parts of a quote.
const ELLIPSIS = /\s*(?:\[\s*(?:…|\.\.\.)\s*\]|…)\s*/

/**
 * Where `quote` appears in `markdown`, from the start of its first character
 * to the end of its last one. An ellipsis splits the quote into parts that
 * must appear in that order. Returns null when the quote is not found once.
 */
export function locateQuote(
  markdown: string,
  quote: string
): { start: number; end: number } | null {
  const source = fold(markdown.normalize('NFC'))
  const parts = quote
    .normalize('NFC')
    .split(ELLIPSIS)
    .map(part => fold(part).text.trim())
    .filter(part => part !== '')
  if (parts.length === 0) return null

  // Each start of the first part that the other parts follow, in order.
  const matches: { start: number; end: number }[] = []
  const first = parts[0]!
  for (
    let at = source.text.indexOf(first);
    at !== -1;
    at = source.text.indexOf(first, at + 1)
  ) {
    let end = at + first.length
    for (const part of parts.slice(1)) {
      const next = source.text.indexOf(part, end)
      if (next === -1) {
        end = -1
        break
      }
      end = next + part.length
    }
    if (end !== -1) matches.push({ start: at, end })
  }
  // Starts that reach the same end are one occurrence: keep the closest.
  const occurrences = new Map<number, number>()
  for (const match of matches) occurrences.set(match.end, match.start)
  if (occurrences.size !== 1) return null
  const [end, start] = [...occurrences][0]!
  return {
    start: source.offsets[start]!,
    end: source.offsets[end - 1]! + 1,
  }
}
