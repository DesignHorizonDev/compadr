import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown, parseBlocks, parseInline } from './markdown.tsx'

afterEach(cleanup)

describe('parseBlocks', () => {
  it('reads paragraphs, nested items, headings, tables and code', () => {
    const source = [
      'First line',
      'continued.',
      '',
      '- item',
      '  - nested',
      '1. ordered',
      '#### Title',
      '| a | b |',
      '| - | - |',
      '```sh',
      '### not a heading',
      '```',
    ].join('\n')
    expect(
      parseBlocks(source).map(b => [
        b.kind,
        source.slice(b.start, b.end),
        b.depth,
        b.marker,
      ])
    ).toEqual([
      ['paragraph', 'First line\ncontinued.', 0, null],
      ['item', 'item', 0, null],
      ['item', 'nested', 1, null],
      ['item', 'ordered', 0, '1.'],
      ['heading', 'Title', 0, null],
      ['table', '| a | b |\n| - | - |', 0, null],
      ['code', '### not a heading', 0, null],
    ])
  })
})

describe('parseInline', () => {
  it('reads code, strong, emphasis and the text of a link', () => {
    const source = 'Use `pool` **only *once*** per [process](https://x.test).'
    expect(
      parseInline(source, 0, source.length).map(leaf => [
        source.slice(leaf.start, leaf.end),
        leaf.code,
        leaf.strong,
        leaf.em,
      ])
    ).toEqual([
      ['Use ', false, false, false],
      ['pool', true, false, false],
      [' ', false, false, false],
      ['only ', false, true, false],
      ['once', false, true, true],
      [' per ', false, false, false],
      ['process', false, false, false],
      ['.', false, false, false],
    ])
  })
})

describe('Markdown', () => {
  it('strikes through a mark across styles and names who replaced it', () => {
    const source = 'Keep this. An invoice is sent on the **first day**. Keep.'
    const start = source.indexOf('An invoice')
    const end = source.indexOf('. Keep.')
    const { container } = render(
      <Markdown
        source={source}
        marks={[
          { start, end, title: 'Replaced by ADR-0007', note: 'ADR-0007' },
        ]}
      />
    )
    const struck = [...container.querySelectorAll('del')]
    expect(struck.map(del => del.textContent).join('')).toBe(
      'An invoice is sent on the first day'
    )
    expect(container.querySelector('strong del, del strong')).not.toBeNull()
    expect(container.querySelectorAll('.replaced-by')).toHaveLength(1)
    expect(container.textContent).toBe(
      'Keep this. An invoice is sent on the first dayADR-0007. Keep.'
    )
  })

  it('renders no HTML of the record and no link', () => {
    const { container } = render(
      <Markdown source={'<img src=x onerror=alert(1)> [a](javascript:x)'} />
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('<img src=x onerror=alert(1)> a')
  })
})

describe('Markdown on identifiers, brackets and tables', () => {
  it('keeps underscores and lone brackets as written', () => {
    const { container } = render(
      <Markdown source="Call __init__ then see [a] and [b](https://x.test)." />
    )
    expect(container.querySelector('strong')).toBeNull()
    expect(container.textContent).toBe('Call __init__ then see [a] and b.')
  })

  it('strikes a rule in a table and in a code block', () => {
    const source =
      '| rule | value |\n| - | - |\n| tax | 20% |\n\n```\nkeep 3\n```'
    const tax = source.indexOf('tax')
    const keep = source.indexOf('keep 3')
    const { container } = render(
      <Markdown
        source={source}
        marks={[
          { start: tax, end: tax + 3, title: 'Replaced', note: 'ADR-0002' },
          { start: keep, end: keep + 6, title: 'Replaced', note: 'ADR-0003' },
        ]}
      />
    )
    expect(
      [...container.querySelectorAll('pre del')].map(d => d.textContent)
    ).toEqual(['tax', 'keep 3'])
    expect(
      [...container.querySelectorAll('.replaced-by')].map(n => n.textContent)
    ).toEqual(['ADR-0002', 'ADR-0003'])
  })
})
