import { describe, expect, it } from 'vitest'
import { parseAdr } from './parse-adr.ts'

const MADR = `---
status: accepted
date: 2026-10-06
decision-makers: [Ada]
compadr:
  feature: access-rights
  parent: 0010
  rule: "  Only the admins of an
    activity list its directory. "
  anchors:
    "src/directory.ts#listAdmins":
      fingerprint: sha256:0123456789abcdef
    "src/directory.ts#DirectoryService.list":
      fingerprint: sha256:fedcba9876543210
      lines: { count: 3, fingerprint: sha256:00112233445566ff }
    "src/no-symbol.ts":
      fingerprint: sha256:0123456789abcdef
    "src/bad.ts#bad":
      fingerprint: md5:123
---

# Restrict the directory to admins

Amends ADR-0010 and ADR-0004.

## Context and Problem Statement

The directory follows ADR-0007.
`

const ADR_TOOLS = `# 12. Use PostgreSQL

Date: 2025-03-14

## Status

Superseded by ADR-0020

## Context

See ADR 3.
`

const LOG4BRAINS = `# ADR-0005 — Queue jobs with BullMQ

- Status: accepted
- Date: 2025-11-02
- Amended by ADR-0009, ADR-0011

## Context and Problem Statement
`

const FRENCH = `# 0008 : Cloisonner les droits par activité

- **Statut** : Remplacée par l'ADR-0015
- **Date** : 2026-01-20
- Précise ADR-0002

## Contexte
`

describe('parseAdr', () => {
  it('reads a MADR record with compadr fields', () => {
    expect(parseAdr('docs/adr/0011-directory-admins.md', MADR)).toEqual({
      number: 11,
      slug: 'directory-admins',
      title: 'Restrict the directory to admins',
      rawStatus: 'accepted',
      status: 'accepted',
      date: '2026-10-06',
      amends: [4, 10],
      amendedBy: [],
      supersededBy: [],
      mentions: [4, 7, 10],
      feature: 'access-rights',
      parent: 10,
      anchors: {
        'src/directory.ts#listAdmins': {
          fingerprint: 'sha256:0123456789abcdef',
          lines: null,
        },
        'src/directory.ts#DirectoryService.list': {
          fingerprint: 'sha256:fedcba9876543210',
          lines: { count: 3, fingerprint: 'sha256:00112233445566ff' },
        },
      },
      checked: {},
      deciders: ['Ada'],
      rule: 'Only the admins of an activity list its directory.',
      lineCount: 28,
    })
  })

  it('reads an adr-tools record with a status section', () => {
    expect(parseAdr('0012-use-postgresql.md', ADR_TOOLS)).toMatchObject({
      number: 12,
      title: 'Use PostgreSQL',
      rawStatus: 'Superseded by ADR-0020',
      status: 'superseded',
      date: '2025-03-14',
      supersededBy: [20],
      amendedBy: [],
      mentions: [3, 20],
    })
  })

  it('reads a Log4brains record with bullets', () => {
    expect(parseAdr('0005-bullmq.md', LOG4BRAINS)).toMatchObject({
      title: 'Queue jobs with BullMQ',
      status: 'accepted',
      date: '2025-11-02',
      amends: [],
      amendedBy: [9, 11],
    })
  })

  it('reads a French record', () => {
    expect(parseAdr('0008-droits.md', FRENCH)).toMatchObject({
      title: 'Cloisonner les droits par activité',
      rawStatus: "Remplacée par l'ADR-0015",
      status: 'superseded',
      date: '2026-01-20',
      supersededBy: [15],
      // The status line names 0015 with a passive form.
      amendedBy: [15],
      amends: [2],
    })
  })

  it('accepts Windows line endings', () => {
    expect(
      parseAdr('0005-bullmq.md', LOG4BRAINS.replace(/\n/g, '\r\n'))
    ).toMatchObject({ status: 'accepted', amendedBy: [9, 11] })
  })

  it('falls back to a line search when the frontmatter is not valid YAML', () => {
    const broken = '---\nstatus: proposed\ntitle: a: b: c\n---\n\n# Title\n'
    expect(parseAdr('0001-broken.md', broken)).toMatchObject({
      status: 'proposed',
      feature: null,
    })
  })

  it('ignores a compadr field of the wrong type', () => {
    const odd =
      '---\nstatus: accepted\ncompadr:\n  feature: [a]\n  parent: x\n---\n# T\n'
    expect(parseAdr('0001-odd.md', odd)).toMatchObject({
      feature: null,
      parent: null,
    })
  })

  it('does not count a decision citing itself', () => {
    const self =
      '# 3. Title\n\nStatus: accepted\nAmends ADR-0003 and ADR-0001\n'
    expect(parseAdr('0003-self.md', self)).toMatchObject({
      amends: [1],
      mentions: [1],
    })
  })

  it('returns an unknown status and the file name when nothing is declared', () => {
    expect(parseAdr('0004-empty.md', 'No title here\n')).toMatchObject({
      title: '0004-empty.md',
      rawStatus: '',
      status: 'unknown',
      date: null,
    })
  })

  it('returns null for a file that is not a decision record', () => {
    expect(parseAdr('docs/adr/README.md', '# Index\n')).toBeNull()
  })

  describe('status line', () => {
    it.each([
      ['- **Status:** Accepted (2026-09-15)', 'Accepted (2026-09-15)'],
      ['- **Status**: Accepted', 'Accepted'],
      ['- **Statut** : acceptée', 'acceptée'],
      ['**Statut :** Proposée', 'Proposée'],
      ['Status: accepted', 'accepted'],
    ])('reads "%s"', (line, rawStatus) => {
      expect(parseAdr('0001-a.md', `# T\n\n${line}\n`)).toMatchObject({
        rawStatus,
      })
    })

    it('ignores prose that starts with the word Status', () => {
      const prose =
        '# T\n\nStatus quo is kept for the cache.\n\n## Status\n\nAccepted\n'
      expect(parseAdr('0001-a.md', prose)).toMatchObject({
        rawStatus: 'Accepted',
        status: 'accepted',
      })
    })

    it('does not take the next paragraph for an empty status', () => {
      const empty =
        '# T\n\nStatus:\n\nSome intro text\n\n## Status\n\nProposed\n'
      expect(parseAdr('0001-a.md', empty)).toMatchObject({
        rawStatus: 'Proposed',
      })
    })

    it('counts an active link written on the status line', () => {
      expect(
        parseAdr('0004-a.md', '# T\n\nStatus: Accepted, amends ADR-0003\n')
      ).toMatchObject({ amends: [3], amendedBy: [] })
    })

    it('reads the decisions that an amendment section names', () => {
      const text = [
        '# ADR 0037 — Provider',
        '',
        'Status: Accepted',
        '',
        '## Decision',
        '',
        'Follows ADR-0012.',
        '',
        '## Amendement',
        '',
        'L’ADR-0040 remplace le modèle du palier nano.',
        '',
        '### Details',
        '',
        'See ADR-0020.',
        '',
        '## Consequences',
        '',
        'ADR-0041 reads the same table.',
        '',
      ].join('\n')
      expect(parseAdr('0037-provider.md', text)).toMatchObject({
        amends: [20],
        amendedBy: [40],
        mentions: [12, 20, 40, 41],
      })
    })

    it('keeps reading an amendment section after a code block', () => {
      const text = [
        '# ADR 0037 — Provider',
        '',
        'Status: Accepted',
        '',
        '## Amendment',
        '',
        '```sh',
        '# ADR-0003 asked for this flag',
        'run --flag',
        '```',
        '',
        'ADR-0050 changes the default.',
        '',
      ].join('\n')
      expect(parseAdr('0037-provider.md', text)).toMatchObject({
        amends: [3],
        amendedBy: [50],
      })
    })
  })

  it('ends the header after the first paragraph when there is no section', () => {
    const short =
      '# T\n\nStatus: Accepted\n\nWe amend the config as described in ADR-0004.\n'
    expect(parseAdr('0005-short.md', short)).toMatchObject({
      amends: [],
      mentions: [4],
    })
  })

  describe('title', () => {
    it('skips a YAML comment of the frontmatter', () => {
      const commented = '---\n# note\nstatus: accepted\n---\n\n# Real title\n'
      expect(parseAdr('0001-a.md', commented)).toMatchObject({
        title: 'Real title',
        status: 'accepted',
      })
    })

    it.each([
      ['# ADR 0001 — Record decisions', 'Record decisions'],
      ['# ADR-0043 — Panels', 'Panels'],
      ['# 12. Use PostgreSQL', 'Use PostgreSQL'],
      ['# 0008 : Cloisonner', 'Cloisonner'],
      ['# 2FA for admins', '2FA for admins'],
    ])('reads "%s"', (line, title) => {
      expect(parseAdr('0001-a.md', `${line}\n`)).toMatchObject({ title })
    })
  })

  it.each([
    ['a\nb\n', 2],
    ['a\nb', 2],
    ['a\n', 1],
    ['', 0],
  ])('counts the lines of %j like wc -l', (content, lineCount) => {
    expect(parseAdr('0001-a.md', content)).toMatchObject({ lineCount })
  })
})

describe('compadr.checked', () => {
  it('reads the date each reference was checked, and leaves out the rest', () => {
    const text = [
      '---',
      'compadr:',
      '  checked:',
      '    "src/a.ts:2": 2026-11-04T09:12:00Z',
      '    "src/b.ts": 2026-11-04T10:12:00+01:00',
      '    "src/c.ts": yesterday',
      '---',
      '# ADR 0001 — A',
      '',
    ].join('\n')
    expect(parseAdr('0001-a.md', text)?.checked).toEqual({
      'src/a.ts:2': { at: '2026-11-04T09:12:00Z', by: null },
      'src/b.ts': { at: '2026-11-04T09:12:00Z', by: null },
    })
  })

  it('reads the person who checked, from the long form', () => {
    const text = [
      '---',
      'compadr:',
      '  checked:',
      '    "src/a.ts:2":',
      '      at: 2026-11-04T09:12:00Z',
      '      by: Ana Martin',
      '    "src/b.ts":',
      '      by: Bo Lee',
      '---',
      '# ADR 0001 — A',
      '',
    ].join('\n')
    expect(parseAdr('0001-a.md', text)?.checked).toEqual({
      'src/a.ts:2': { at: '2026-11-04T09:12:00Z', by: 'Ana Martin' },
    })
  })
})

describe('the deciders of a record', () => {
  const record = (lines: string[]) =>
    parseAdr('0001-a.md', [...lines, '', '## Context', ''].join('\n'))?.deciders

  it('reads decision-makers in the frontmatter of MADR', () => {
    expect(
      record([
        '---',
        'status: accepted',
        'decision-makers: Ana Martin, Bo Lee',
        '---',
        '# Use a queue',
      ])
    ).toEqual(['Ana Martin', 'Bo Lee'])
    expect(
      record([
        '---',
        'decision-makers:',
        '  - Ana Martin',
        '---',
        '# Use a queue',
      ])
    ).toEqual(['Ana Martin'])
  })

  it('reads a Deciders line of the header (MADR 2, Log4brains)', () => {
    expect(
      record(['# Use a queue', '', '- Status: accepted', '- Deciders: Ana, Bo'])
    ).toEqual(['Ana', 'Bo'])
    expect(
      record(['# 1. Une file', '', '* **Décideurs** : Ana Martin; Bo Lee'])
    ).toEqual(['Ana Martin', 'Bo Lee'])
  })

  it('reads nothing from a record that names no one', () => {
    expect(record(['# Use a queue', '', 'Status: accepted'])).toEqual([])
  })
})

describe('a list of decisions after one ADR prefix', () => {
  const header = (line: string) =>
    parseAdr(
      'docs/adr/0045-a.md',
      `# 45. A\n\n- Statut : acceptée\n- ${line}\n`
    )!

  it.each([
    [
      "Complète les ADR 0002, 0010 et 0012. L'inscription reste fermée.",
      [2, 10, 12],
    ],
    ['Amende les ADR 0010 et 0011 sur un point.', [10, 11]],
    [
      'Complète les ADR 0010, 0012 et 0018. Remplace trois règles :',
      [10, 12, 18],
    ],
    ['Amends ADRs 3 and 4.', [3, 4]],
    ['Amends ADR-0003, ADR-0004 & 0005.', [3, 4, 5]],
    // Numbers without leading zeros grow by one digit.
    ['Amends ADR 9, 10 and 11.', [9, 10, 11]],
    // A comma before the last conjunction.
    ['Amende les ADR 2, 3, ou 4.', [2, 3, 4]],
    ['Amends ADRs 3, 4, and 5.', [3, 4, 5]],
  ] as const)('reads every decision of %j', (line, amends) => {
    expect(header(line).amends).toEqual(amends)
  })

  it.each([
    // A number of another width is not a decision: a count, a date.
    ["Complète l'ADR 0010 et 3 autres points.", [10]],
    ['Amends ADR 0010, 2026-10-21.', [10]],
    ['Amends ADR 12, 1.5 times the limit.', [12]],
    // A smaller number of another width is not the next decision.
    ['Amends ADR 10, 9 more points.', [10]],
    ['Amends ADR 0009, 10 more points.', [9]],
  ] as const)('reads no other number in %j', (line, amends) => {
    expect(header(line).amends).toEqual(amends)
  })

  it('reads the passive form and the mentions the same way', () => {
    const document = parseAdr(
      'docs/adr/0008-a.md',
      '# 8. A\n\n- Amendée par les ADR 0031 et 0034.\n\n## Context\n\nSee ADR 0002 and 0003.\n'
    )!
    expect(document.amendedBy).toEqual([31, 34])
    expect(document.mentions).toEqual([2, 3, 31, 34])
  })
})

describe('a status written as a dated list', () => {
  const status = (markdown: string) => {
    const document = parseAdr('doc/adr/0010-cache.md', markdown)!
    return { rawStatus: document.rawStatus, status: document.status }
  }

  it('reads the latest state of a `## Status` list', () => {
    expect(
      status(
        '# 10. Cache\n\n## Status\n\n- 2024-09-02: Drafted\n- 2024-09-09: Accepted\n- 2025-04-04: Edited (Added chronological status)\n\n## Context\n'
      )
    ).toEqual({ rawStatus: '2024-09-09: Accepted', status: 'accepted' })
  })

  it.each([
    ['- 2024-03-12: Drafted\n- 2024-03-14: Merged', 'accepted'],
    ['- 2024-06-04: Drafted\n- 2024-06-24: Approved', 'accepted'],
    ['- 2026-04-07: Drafted\n- 2026-08-12: Rejected', 'rejected'],
    ['- 2025-12-24: Drafted', 'proposed'],
    ['- 2025-05-19: Drafted & Accepted', 'accepted'],
    ['- 2025-11-11: Drafted\n- 2025-11-13: Edited & Accepted', 'accepted'],
    [
      '- 2025-05-19: Drafted & Accepted\n- 2026-11-05: Superseded by [ADR 0034](./0034-flow.md) (flows are compiled)',
      'superseded',
    ],
    // A partial supersession leaves the decision in force.
    [
      '- 2024-10-31: Merged\n- 2026-11-05: Partially superseded by [ADR 0034](./0034-flow.md)',
      'accepted',
    ],
    // The list is read by date, whatever its order.
    ['- 2025-03-24: Accepted\n- 2024-10-22: Drafted', 'accepted'],
    // Words between parentheses are a note, not a state.
    ['- 2024-04-02: Drafted (not accepted yet)', 'proposed'],
    // A sentence that starts with "Decided" is not a state.
    ['- 2024-02-20: Drafted\n- 2024-03-01: Decided to wait', 'proposed'],
  ] as const)('reads %j as %s', (list, expected) => {
    expect(status(`# 10. Cache\n\n## Status\n\n${list}\n`).status).toBe(
      expected
    )
  })

  it('reads the superseding decisions of the latest state', () => {
    const document = parseAdr(
      'doc/adr/0023-config.md',
      '# 23. Config\n\n## Status\n\n- 2025-05-19: Drafted & Accepted\n- 2026-11-05: Superseded by [ADR 0034](./0034-flow.md)\n'
    )!
    expect(document.supersededBy).toEqual([34])
  })

  it('reads dated lines of the header', () => {
    expect(
      status(
        '# 29. Use pnpm\n\n2024-10-31: proposed\n2024-11-21: postponed to later\n2025-12-09: Accepted\n\n## Context\n'
      )
    ).toEqual({ rawStatus: '2025-12-09: Accepted', status: 'accepted' })
  })

  it('reads no state from a sentence of the header', () => {
    expect(
      status(
        '# 10. Cache\n\n2024-01-01: Decided to use Postgres\n\n## Context\n'
      ).status
    ).toBe('unknown')
  })

  it('keeps a section that is not a dated list as it reads it', () => {
    expect(status('# 10. Cache\n\n## Status\n\nAccepted\n').status).toBe(
      'accepted'
    )
  })

  it('leaves the status unknown when no entry gives a state', () => {
    expect(
      status('# 10. Cache\n\n## Status\n\n- 2025-04-04: Edited\n').status
    ).toBe('unknown')
  })
})
