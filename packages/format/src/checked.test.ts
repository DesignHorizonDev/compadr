import { describe, expect, it } from 'vitest'
import { checkedLines, writeChecked } from './checked.ts'
import { parseAdr } from './parse-adr.ts'

describe('writeChecked', () => {
  it('records the checks and keeps the rest of the frontmatter', () => {
    const record = [
      '---',
      'compadr:',
      '  feature: billing # the main feature',
      '---',
      '# ADR 0003 — Invoices',
      '',
      'See `src/a.ts:2`.',
      '',
    ].join('\n')
    const written = writeChecked(record, [
      { text: 'src/a.ts:2', at: '2026-11-04T09:12:00Z' },
    ])
    expect(written).toBe(
      [
        '---',
        'compadr:',
        '  feature: billing # the main feature',
        '  checked:',
        '    src/a.ts:2: 2026-11-04T09:12:00Z',
        '---',
        '# ADR 0003 — Invoices',
        '',
        'See `src/a.ts:2`.',
        '',
      ].join('\n')
    )
    expect(parseAdr('0003-invoices.md', written)?.checked).toEqual({
      'src/a.ts:2': { at: '2026-11-04T09:12:00Z', by: null },
    })
    expect(writeChecked(record, [])).toBe(record)
  })

  it('writes the person who checked in the long form', () => {
    const written = writeChecked('# ADR 0003 — Invoices\n', [
      { text: 'src/a.ts:2', at: '2026-11-04T09:12:00Z', by: 'Ana Martin' },
    ])
    expect(written).toBe(
      [
        '---',
        'compadr:',
        '  checked:',
        '    src/a.ts:2:',
        '      at: 2026-11-04T09:12:00Z',
        '      by: Ana Martin',
        '---',
        '',
        '# ADR 0003 — Invoices',
        '',
      ].join('\n')
    )
    expect(parseAdr('0003-invoices.md', written)?.checked).toEqual({
      'src/a.ts:2': { at: '2026-11-04T09:12:00Z', by: 'Ana Martin' },
    })
  })
})

describe('checkedLines', () => {
  it('gives the line of the record where each entry starts', () => {
    const record = [
      '---',
      'compadr:',
      '  feature: billing',
      '  checked:',
      '    "src/a.ts:2": 2026-11-04T09:12:00Z',
      '    src/b.ts:',
      '      at: 2026-11-04T09:12:00Z',
      '---',
      '# ADR 0003 — Invoices',
    ].join('\n')
    expect([...checkedLines(record)]).toEqual([
      ['src/a.ts:2', 5],
      ['src/b.ts', 6],
    ])
    expect(checkedLines('# ADR 0003 — Invoices\n').size).toBe(0)
  })
})
