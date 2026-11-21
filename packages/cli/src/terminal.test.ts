import { describe, expect, it } from 'vitest'
import { terminalText } from './terminal.ts'

describe('terminalText', () => {
  it('shows each control character of a line, and keeps breaks and tabs', () => {
    expect(terminalText('src/a\u001b[32m.ts:1\tTitle\u001b]0;x\u0007\n')).toBe(
      'src/a\ufffd[32m.ts:1\tTitle\ufffd]0;x\ufffd\n'
    )
    expect(terminalText('plain «text» — 日本')).toBe('plain «text» — 日本')
  })
})
