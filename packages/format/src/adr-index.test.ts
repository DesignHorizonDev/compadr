import { describe, expect, it } from 'vitest'
import { parseAdrIndex } from './adr-index.ts'

describe('parseAdrIndex', () => {
  it('reads the number and the status column of each row', () => {
    const index = `# Decisions

| ADR | Title | Status |
|---|---|---|
| [0001](0001-record.md) | Record decisions | Accepted |
| 0002 | Use Yarn | Superseded by ADR-0007 |
| Notes | Not a decision | — |
`
    expect([...parseAdrIndex(index)]).toEqual([
      [1, 'Accepted'],
      [2, 'Superseded by ADR-0007'],
    ])
  })

  it('finds the status column when other columns follow it', () => {
    const index = `| N° | **Statut** | Décision | Date |
|---|---|---|---|
| [0012](0012-a.md) | acceptée | Foo | 2026-01-02 |
`
    expect([...parseAdrIndex(index)]).toEqual([[12, 'acceptée']])
  })

  it('skips a table without a status column', () => {
    const index = `| ADR | Title | Date |
|---|---|---|
| 0001 | Record decisions | 2026-01-02 |

| ADR | Status |
|---|---|
| 0002 | Accepted |
`
    expect([...parseAdrIndex(index)]).toEqual([[2, 'Accepted']])
  })

  it('returns an empty map without a table', () => {
    expect(parseAdrIndex('# Decisions\n\n- 0001 Record\n').size).toBe(0)
  })
})
