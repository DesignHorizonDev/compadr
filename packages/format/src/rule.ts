// The rule of a decision: what it requires, in one sentence that an agent
// reads before it opens the record. A record declares it in `compadr.rule`;
// otherwise the rule is the first sentence of the Decision section, when that
// sentence can stand alone. A record whose decision is a list of topics has
// no rule: its section headings tell where to read instead.
import { editFrontmatter, ensureMap } from './frontmatter-edit.ts'
import type { DecisionSection } from './record-text.ts'

/** Where the rule of a decision comes from. */
export const RULE_SOURCES = ['declared', 'first-sentence'] as const
export type RuleSource = (typeof RULE_SOURCES)[number]

export interface DecisionRule {
  text: string
  source: RuleSource
}

/** Longest rule that the report keeps, in characters. */
export const MAX_RULE_LENGTH = 240

/** Shorter than this, a sentence rarely says what is required. */
const MIN_RULE_LENGTH = 30

// A sentence about the record, or about how its author decided, not about
// the code: "This ADR replaces…", "L'auteur a pris quatre décisions…".
const ABOUT_THE_RECORD =
  /^(?:(?:this (?:adr|record|document)|cet adr|ce document)\b|(?:the author|l['’]auteur) (?:made|took|has made|a pris)\b)/i

// The end of a sentence: a full stop before a capital, a quote or the end.
// "schema.prisma" and "v1.0.0" do not end a sentence, nor an abbreviation
// before a name: "e.g. Alice", "cf. ADR 3", "etc. Then".
const SENTENCE_END =
  /(?<!\b(?:e\.g|i\.e|etc|cf|vs|resp|approx|ex|p\. ex|Mr|Mrs|Dr|St|n°))[.!?](?=\s+[\p{Lu}«"“`*(]|\s*$)/u

const FENCE = /^[ \t]*(?:```|~~~)/
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/

/**
 * True when `text` says too little to stand alone as the rule of a decision:
 * too short, about the record rather than the code, or the opening of a list.
 */
export function isWeakRule(text: string): boolean {
  const trimmed = text.trim()
  return (
    trimmed.length < MIN_RULE_LENGTH ||
    trimmed.endsWith(':') ||
    ABOUT_THE_RECORD.test(trimmed)
  )
}

/** Markdown inline marks that a rule does not need: emphasis and links. */
function plain(markdown: string): string {
  return (
    markdown
      // The text of a link holds no bracket: a run of `[` is read once.
      .replace(/\[([^[\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** The first paragraph of prose, or the first item of a list. */
function firstBlock(markdown: string): string | null {
  const block: string[] = []
  let fenced = false
  let item = false
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced
      if (block.length > 0) break
      continue
    }
    if (fenced) continue
    const trimmed = line.trim()
    if (trimmed === '') {
      if (block.length > 0) break
      continue
    }
    if (/^(?:#|\||>|<!--)/.test(trimmed)) {
      if (block.length > 0) break
      continue
    }
    if (LIST_ITEM.test(line)) {
      if (block.length > 0) break
      item = true
      block.push(line.replace(LIST_ITEM, ''))
      continue
    }
    // An item goes on with its indented lines only.
    if (item && !/^\s/.test(line)) break
    block.push(trimmed)
  }
  return block.length > 0 ? block.join(' ') : null
}

/** Index of the first ": " outside a code span, or -1. */
function colonOutsideCode(text: string): number {
  let code = false
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '`') code = !code
    else if (!code && text[i] === ':' && text[i + 1] === ' ') return i
  }
  return -1
}

function shorten(text: string): string {
  if (text.length <= MAX_RULE_LENGTH) return text
  const cut = text.slice(0, MAX_RULE_LENGTH - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > MAX_RULE_LENGTH / 2 ? cut.slice(0, space) : cut}…`
}

/**
 * The first sentence of a decision, when it can stand alone. A sentence that
 * opens a list ("Four pieces: Storage…") keeps the part before the colon.
 */
export function firstSentence(
  sections: readonly DecisionSection[]
): string | null {
  for (const section of sections) {
    const block = firstBlock(section.markdown)
    if (block === null) continue
    // "**1. Three regions.** The centre…": the number of a bold lead goes.
    const text = plain(block).replace(/^\d+[.)]\s+/, '')
    const end = SENTENCE_END.exec(text)
    let sentence = end === null ? text : text.slice(0, end.index + 1)
    // "Label: value" is a sentence; "A long opening: item, item" is a list.
    const colon = colonOutsideCode(sentence)
    if (colon >= MIN_RULE_LENGTH) sentence = sentence.slice(0, colon)
    sentence = sentence.trim()
    return isWeakRule(sentence) ? null : shorten(sentence)
  }
  return null
}

/**
 * The rule of a decision: the declared one, else the first sentence of its
 * Decision section when it can stand alone, else null.
 */
export function decisionRule(
  declared: string | null,
  sections: readonly DecisionSection[]
): DecisionRule | null {
  if (declared !== null && declared.trim() !== '') {
    return { text: shorten(declared.trim()), source: 'declared' }
  }
  const sentence = firstSentence(sections)
  return sentence === null ? null : { text: sentence, source: 'first-sentence' }
}

/** Headings of the subsections of a decision, without their numbering. */
export function sectionHeadings(
  sections: readonly DecisionSection[]
): string[] {
  return sections.flatMap(section =>
    section.heading === null
      ? []
      : [plain(section.heading.replace(/^\d+[.)]?\s+/, ''))]
  )
}

/** Writes `compadr.rule` in the frontmatter of a record. */
export function applyRuleEdit(markdown: string, rule: string): string {
  return editFrontmatter(markdown, document => {
    ensureMap(document, ['compadr'])
    document.setIn(['compadr', 'rule'], rule.trim().replace(/\s+/g, ' '))
  })
}
