import { describe, expect, it } from 'vitest'
import { parseAdrFileName } from './adr-file.ts'

describe('parseAdrFileName', () => {
  it('reads the number and the slug', () => {
    expect(parseAdrFileName('0012-use-postgres.md')).toEqual({
      number: 12,
      slug: 'use-postgres',
    })
  })

  it('keeps the slug as written', () => {
    expect(parseAdrFileName('0003-Garder_le_dépôt.md')).toEqual({
      number: 3,
      slug: 'Garder_le_dépôt',
    })
  })

  it.each([
    'README.md',
    'template.md',
    '12-short-number.md',
    '0012-no-extension',
    '0012-.md',
    '0012-wrong-extension.mdx',
  ])('rejects %s', fileName => {
    expect(parseAdrFileName(fileName)).toBeNull()
  })
})
