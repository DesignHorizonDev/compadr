// Renders the Markdown of a decision section as React elements, without
// HTML: paragraphs, list items, headings, tables and code blocks, with code,
// emphasis and link text inline. Ranges of the source can be struck through,
// for the rules that a later decision replaces.
import type { ReactNode } from 'react'

/** A range of the source to strike through, with its explanation. */
export interface Mark {
  start: number
  end: number
  title: string
  /** Short note shown after the struck text: `ADR-0019`. */
  note: string
}

export interface Block {
  kind: 'paragraph' | 'item' | 'heading' | 'code' | 'table'
  /** Offsets of the content in the source. */
  start: number
  end: number
  /** Nesting level of a list item. */
  depth: number
  /** Marker of an ordered list item: `1.`. */
  marker: string | null
}

const FENCE = /^[ \t]*(?:```|~~~)/
const ITEM = /^([ \t]*)([-*+]|\d+[.)])[ \t]+/
const HEADING = /^#{1,6}[ \t]+/
const TABLE = /^[ \t]*\|/

/** Splits the source into blocks, with the offsets of their content. */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  let fence: Block | null = null
  let offset = 0
  for (const line of source.split('\n')) {
    const start = offset
    const end = offset + line.length
    offset = end + 1
    if (fence !== null) {
      if (FENCE.test(line)) {
        fence = null
      } else {
        if (fence.start === -1) fence.start = start
        fence.end = end
      }
      continue
    }
    if (FENCE.test(line)) {
      fence = { kind: 'code', start: -1, end: -1, depth: 0, marker: null }
      blocks.push(fence)
      current = null
      continue
    }
    if (line.trim() === '') {
      current = null
      continue
    }
    const item = ITEM.exec(line)
    const heading = HEADING.exec(line)
    if (item !== null) {
      current = {
        kind: 'item',
        start: start + item[0].length,
        end,
        depth: Math.floor(item[1]!.replace(/\t/g, '  ').length / 2),
        marker: /\d/.test(item[2]!) ? item[2]! : null,
      }
      blocks.push(current)
    } else if (heading !== null) {
      blocks.push({
        kind: 'heading',
        start: start + heading[0].length,
        end,
        depth: 0,
        marker: null,
      })
      current = null
    } else if (TABLE.test(line)) {
      if (current?.kind === 'table') {
        current.end = end
      } else {
        current = { kind: 'table', start, end, depth: 0, marker: null }
        blocks.push(current)
      }
    } else if (current !== null && current.kind !== 'table') {
      current.end = end
    } else {
      current = { kind: 'paragraph', start, end, depth: 0, marker: null }
      blocks.push(current)
    }
  }
  // An empty code block has no content offsets.
  return blocks.map(block =>
    block.start === -1 ? { ...block, start: 0, end: 0 } : block
  )
}

export interface Leaf {
  start: number
  end: number
  code: boolean
  strong: boolean
  em: boolean
}

type Style = Pick<Leaf, 'strong' | 'em'>

/** The text runs of a block, with their style and their offsets. */
export function parseInline(
  source: string,
  start: number,
  end: number,
  style: Style = { strong: false, em: false }
): Leaf[] {
  const leaves: Leaf[] = []
  let text = start
  const flush = (to: number) => {
    if (to > text) leaves.push({ start: text, end: to, code: false, ...style })
  }
  let i = start
  while (i < end) {
    const char = source[i]!
    if (char === '`') {
      const close = source.indexOf('`', i + 1)
      if (close !== -1 && close < end) {
        flush(i)
        leaves.push({ start: i + 1, end: close, code: true, ...style })
        i = close + 1
        text = i
        continue
      }
    }
    // Only `**` marks strong text: records write `__init__` outside code.
    if (source.startsWith('**', i)) {
      const marker = '**'
      let close = source.indexOf(marker, i + 2)
      // In `***`, the last two stars close the strong text.
      while (close !== -1 && source[close + 2] === marker[0]) close++
      if (close !== -1 && close < end) {
        flush(i)
        leaves.push(
          ...parseInline(source, i + 2, close, { ...style, strong: true })
        )
        i = close + 2
        text = i
        continue
      }
    }
    if (char === '*' && /\S/.test(source[i + 1] ?? '')) {
      const close = source.indexOf('*', i + 1)
      if (close !== -1 && close < end && /\S/.test(source[close - 1]!)) {
        flush(i)
        leaves.push(
          ...parseInline(source, i + 1, close, { ...style, em: true })
        )
        i = close + 1
        text = i
        continue
      }
    }
    if (char === '[') {
      // A link shows its text only: the console opens no link of a record.
      const middle = source.indexOf('](', i + 1)
      const close = middle === -1 ? -1 : source.indexOf(')', middle + 2)
      // `[a] and [b](u)`: the first bracket closes before the link.
      const bracket = source.indexOf(']', i + 1)
      if (middle !== -1 && bracket === middle && close !== -1 && close < end) {
        flush(i)
        leaves.push(...parseInline(source, i + 1, middle, style))
        i = close + 1
        text = i
        continue
      }
    }
    i++
  }
  flush(end)
  return leaves
}

/** The leaves of a block cut at the edges of the marks, with their mark. */
function pieces(leaves: Leaf[], marks: readonly Mark[]) {
  const cuts = marks.flatMap(mark => [mark.start, mark.end])
  return leaves.flatMap(leaf => {
    const edges = [
      leaf.start,
      ...cuts.filter(cut => cut > leaf.start && cut < leaf.end),
      leaf.end,
    ].sort((a, b) => a - b)
    return edges.slice(1).map((to, index) => {
      const from = edges[index]!
      return {
        ...leaf,
        start: from,
        end: to,
        mark: marks.find(mark => mark.start <= from && to <= mark.end),
      }
    })
  })
}

function Inline({
  source,
  block,
  marks,
  plain = false,
}: {
  source: string
  block: Pick<Block, 'start' | 'end'>
  marks: readonly Mark[]
  /** Text as written, without inline Markdown: code blocks and tables. */
  plain?: boolean
}) {
  const leaves: Leaf[] = plain
    ? [{ ...block, code: false, strong: false, em: false }]
    : parseInline(source, block.start, block.end)
  const cut = pieces(leaves, marks)
  // The note follows the last struck piece of each mark in the block.
  const last = new Map<Mark, number>()
  for (const piece of cut) if (piece.mark) last.set(piece.mark, piece.start)
  return (
    <>
      {cut.map(piece => {
        let node: ReactNode = source.slice(piece.start, piece.end)
        if (piece.code) node = <code>{node}</code>
        if (piece.em) node = <em>{node}</em>
        if (piece.strong) node = <strong>{node}</strong>
        if (piece.mark) {
          node = <del title={piece.mark.title}>{node}</del>
        }
        return (
          <span key={piece.start}>
            {node}
            {piece.mark && last.get(piece.mark) === piece.start && (
              <span className="replaced-by" title={piece.mark.title}>
                {piece.mark.note}
              </span>
            )}
          </span>
        )
      })}
    </>
  )
}

/** The Markdown of a section, with the marked ranges struck through. */
export function Markdown({
  source,
  marks = [],
}: {
  source: string
  marks?: readonly Mark[]
}) {
  const blocks = parseBlocks(source)
  const nodes: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    if (block.kind === 'item') {
      // Consecutive items form one list; the depth indents each item.
      const items: Block[] = []
      while (blocks[i]?.kind === 'item') items.push(blocks[i++]!)
      i--
      nodes.push(
        <ul key={block.start} className="md-list">
          {items.map(item => (
            <li
              key={item.start}
              className={item.marker ? 'md-ordered' : undefined}
              style={{ marginLeft: `${item.depth * 18}px` }}
            >
              {item.marker && <span className="md-marker">{item.marker} </span>}
              <Inline source={source} block={item} marks={marks} />
            </li>
          ))}
        </ul>
      )
    } else if (block.kind === 'code' || block.kind === 'table') {
      // The text is shown as written, and a replaced rule is still struck.
      nodes.push(
        <pre key={`pre-${block.start}`} className="code-block md-code">
          <Inline source={source} block={block} marks={marks} plain />
        </pre>
      )
    } else if (block.kind === 'heading') {
      nodes.push(
        <p key={block.start} className="md-heading">
          <Inline source={source} block={block} marks={marks} />
        </p>
      )
    } else {
      nodes.push(
        <p key={block.start}>
          <Inline source={source} block={block} marks={marks} />
        </p>
      )
    }
  }
  return <div className="markdown">{nodes}</div>
}
