import { describe, expect, it } from 'vitest'
import {
  AnchorEditError,
  applyAnchorEdits,
  type AnchorEdit,
} from './anchor-edit.ts'
import { parseAdr } from './parse-adr.ts'

const ANCHOR = { fingerprint: 'sha256:0123456789abcdef', lines: null }

function edit(fields: Partial<AnchorEdit>): AnchorEdit {
  return {
    adrLine: 1,
    column: 1,
    from: 'src/a.ts:3',
    to: 'src/a.ts#charge',
    anchor: ANCHOR,
    ...fields,
  }
}

describe('applyAnchorEdits', () => {
  it('rewrites two references of one line and keeps the frontmatter', () => {
    const markdown = [
      '---',
      'status: accepted # kept',
      'compadr:',
      '  feature: billing',
      '---',
      '# 1. Billing',
      '',
      'See `src/a.ts:3` and `src/b.ts:9`.',
      '',
    ].join('\n')
    const result = applyAnchorEdits(markdown, [
      edit({ adrLine: 8, column: 5 }),
      edit({
        adrLine: 8,
        column: 22,
        from: 'src/b.ts:9',
        to: 'src/b.ts#Refund.run',
        anchor: {
          fingerprint: 'sha256:fedcba9876543210',
          lines: { count: 2, fingerprint: 'sha256:00112233445566ff' },
        },
      }),
    ])
    expect(result).toContain('status: accepted # kept')
    expect(result).toContain('See `src/a.ts#charge` and `src/b.ts#Refund.run`.')
    expect(parseAdr('docs/adr/0001-billing.md', result)).toMatchObject({
      status: 'accepted',
      feature: 'billing',
      anchors: {
        'src/a.ts#charge': ANCHOR,
        'src/b.ts#Refund.run': {
          fingerprint: 'sha256:fedcba9876543210',
          lines: { count: 2, fingerprint: 'sha256:00112233445566ff' },
        },
      },
    })
  })

  it('adds a frontmatter to a record without one', () => {
    const markdown = '# 2. Plain\n\nStatus: accepted\n\nSee `src/a.ts:3`.\n'
    const result = applyAnchorEdits(markdown, [edit({ adrLine: 5, column: 5 })])
    expect(result.startsWith('---\ncompadr:\n  anchors:\n')).toBe(true)
    expect(
      result.endsWith(
        '\n---\n\n# 2. Plain\n\nStatus: accepted\n\nSee `src/a.ts#charge`.\n'
      )
    ).toBe(true)
    expect(parseAdr('0002-plain.md', result)).toMatchObject({
      title: 'Plain',
      status: 'accepted',
      anchors: { 'src/a.ts#charge': ANCHOR },
    })
  })

  it('keeps long values and flow lists of the frontmatter as written', () => {
    const title = `title: ${'A long title '.repeat(8).trim()}`
    const markdown = `---\n${title}\ntags: [a, b] # keep\n---\nSee \`src/a.ts:3\`.\n`
    const result = applyAnchorEdits(markdown, [edit({ adrLine: 5, column: 5 })])
    expect(result).toContain(`${title}\ntags: [a, b] # keep\n`)
  })

  it('fills an empty frontmatter', () => {
    const markdown = '---\n---\n# 5. T\n\nSee `src/a.ts:3`.\n'
    const result = applyAnchorEdits(markdown, [edit({ adrLine: 5, column: 5 })])
    expect(result.match(/^---$/gm)).toHaveLength(2)
    expect(parseAdr('0005-t.md', result)?.anchors).toEqual({
      'src/a.ts#charge': ANCHOR,
    })
  })

  it('keeps the line breaks of a Windows record', () => {
    const markdown =
      '---\r\nstatus: accepted\r\n---\r\n# 3. T\r\n\r\nSee `src/a.ts:3`.\r\n'
    const result = applyAnchorEdits(markdown, [edit({ adrLine: 6, column: 5 })])
    expect(
      result.split('\n').every(line => line === '' || line.endsWith('\r'))
    ).toBe(true)
    expect(result).toContain('See `src/a.ts#charge`.\r\n')
  })

  it('refuses an edit that does not find its text', () => {
    const markdown = '# 4. T\n\nSee `src/a.ts:4`.\n'
    expect(() =>
      applyAnchorEdits(markdown, [edit({ adrLine: 3, column: 5 })])
    ).toThrow(AnchorEditError)
    expect(() =>
      applyAnchorEdits(markdown, [edit({ adrLine: 9, column: 1 })])
    ).toThrow(/line 9, column 1 does not cite `src\/a.ts:3`/)
  })

  it('refuses a frontmatter that is not a YAML map', () => {
    for (const frontmatter of ['status: [accepted', '- a\n- b']) {
      const markdown = `---\n${frontmatter}\n---\nSee \`src/a.ts:3\`.\n`
      const line = frontmatter.split('\n').length + 3
      expect(() =>
        applyAnchorEdits(markdown, [edit({ adrLine: line, column: 5 })])
      ).toThrow(AnchorEditError)
    }
  })

  it('changes nothing without edit', () => {
    expect(applyAnchorEdits('# T\n', [])).toBe('# T\n')
  })
})
