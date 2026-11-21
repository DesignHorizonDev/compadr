import { describe, expect, it } from 'vitest'
import { csrfHeaders } from './csrf.ts'

describe('csrfHeaders', () => {
  it('repeats the token of the cookie', () => {
    expect(csrfHeaders('a=1; compadr_csrf=abc%2B; b=2')).toEqual({
      'X-Compadr-CSRF': 'abc+',
    })
    expect(csrfHeaders('__Host-compadr_csrf=xyz')).toEqual({
      'X-Compadr-CSRF': 'xyz',
    })
  })

  it('gives nothing without the cookie', () => {
    expect(csrfHeaders('a=1')).toEqual({})
    expect(csrfHeaders('')).toEqual({})
  })
})
