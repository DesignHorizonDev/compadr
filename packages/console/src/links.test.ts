import { describe, expect, it } from 'vitest'
import { safeHref } from './links.ts'

describe('safeHref', () => {
  it('keeps an https address only', () => {
    expect(safeHref('https://github.com/o/r/pull/1')).toBe(
      'https://github.com/o/r/pull/1'
    )
    for (const url of [
      'http://github.com/o/r/pull/1',
      'javascript:alert(1)',
      'data:text/html,x',
      '//evil.test',
      '',
      null,
      undefined,
    ]) {
      expect(safeHref(url)).toBeUndefined()
    }
  })
})
