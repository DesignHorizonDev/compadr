import { describe, expect, it } from 'vitest'
import { parseAdr } from './parse-adr.ts'
import { acceptRecordStatus, StatusEditError } from './status-edit.ts'

const DATE = '2026-11-17'
const accept = (markdown: string) => acceptRecordStatus(markdown, DATE)
const statusOf = (markdown: string) =>
  parseAdr('docs/adr/0007-retries.md', markdown)!.status

describe('acceptRecordStatus', () => {
  it.each([
    [
      '# 7. Retries\n\n- **Status:** Proposed (2026-10-04)\n\n## Decision\n\nText.\n',
      '# 7. Retries\n\n- **Status:** Accepted (2026-11-17)\n\n## Decision\n\nText.\n',
    ],
    [
      '# ADR 0007 — Relances\n\n- **Statut** : proposée\n- **Date** : 2026-10-31\n\n## Décision\n',
      '# ADR 0007 — Relances\n\n- **Statut** : acceptée (2026-11-17)\n- **Date** : 2026-10-31\n\n## Décision\n',
    ],
    [
      '# 7. Retries\n\nStatus: proposed\n\n## Decision\n',
      '# 7. Retries\n\nStatus: accepted (2026-11-17)\n\n## Decision\n',
    ],
    [
      '# 7. Retries\n\n**Status**: **Proposed**\n',
      '# 7. Retries\n\n**Status**: **Accepted (2026-11-17)**\n',
    ],
    [
      '# 7. Retries\n\n## Status\n\nProposed\n\n## Decision\n\nStatus: proposed in the text stays.\n',
      '# 7. Retries\n\n## Status\n\nAccepted (2026-11-17)\n\n## Decision\n\nStatus: proposed in the text stays.\n',
    ],
    [
      '---\nstatus: proposed # until the review\ndate: 2026-10-01\n---\n# 7. Retries\n',
      '---\nstatus: accepted\ndate: 2026-10-01\n---\n# 7. Retries\n',
    ],
  ])('accepts %j', (before, after) => {
    expect(statusOf(before)).toBe('proposed')
    expect(accept(before)).toBe(after)
    expect(statusOf(after)).toBe('accepted')
  })

  it('keeps the dollar signs of the record', () => {
    expect(
      accept(
        '---\ntitle: Budget $$ and $& cap\nstatus: proposed\n---\n# 7. Cap $1\n'
      )
    ).toBe(
      '---\ntitle: Budget $$ and $& cap\nstatus: accepted\n---\n# 7. Cap $1\n'
    )
    expect(accept('# 7. Cap $&\n\nStatus: Proposed $1\n')).toBe(
      '# 7. Cap $&\n\nStatus: Accepted (2026-11-17)\n'
    )
  })

  it('refuses a record that is not proposed, or that writes no status', () => {
    expect(() => accept('# 7. Retries\n\nStatus: Accepted\n')).toThrow(
      'the record is accepted, not proposed'
    )
    expect(() => accept('# 7. Retries\n\n## Decision\n')).toThrow(
      StatusEditError
    )
    expect(() =>
      acceptRecordStatus('# 7. Retries\n\nStatus: Proposed\n', 'today')
    ).toThrow('today is not a date')
  })
})

describe('acceptRecordStatus on a dated list', () => {
  it('adds an entry after the latest one', () => {
    const before =
      '# 7. Retries\n\n## Status\n\n- 2024-09-02: Drafted\n- 2024-09-05: Edited (Wording)\n\n## Context\n'
    expect(statusOf(before)).toBe('proposed')
    const after = accept(before)
    expect(after).toBe(
      '# 7. Retries\n\n## Status\n\n- 2024-09-02: Drafted\n- 2024-09-05: Edited (Wording)\n- 2026-11-17: Accepted\n\n## Context\n'
    )
    expect(statusOf(after)).toBe('accepted')
  })

  it('adds a line to the dated lines of the header', () => {
    const before = '# 7. Retries\n\n2024-10-31: proposed\n\n## Context\n'
    const after = accept(before)
    expect(after).toBe(
      '# 7. Retries\n\n2024-10-31: proposed\n2026-11-17: accepted\n\n## Context\n'
    )
    expect(statusOf(after)).toBe('accepted')
  })

  it('refuses a list whose latest state is not proposed', () => {
    expect(() =>
      accept(
        '# 7. Retries\n\n## Status\n\n- 2024-09-02: Drafted\n- 2024-09-09: Accepted\n'
      )
    ).toThrow('the record is accepted, not proposed')
  })
})
