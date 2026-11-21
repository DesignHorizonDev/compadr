import { describe, expect, it } from 'vitest'
import { formatAnchoredPath, parseAnchoredPath, readAnchors } from './anchor.ts'

describe('parseAnchoredPath', () => {
  it.each([
    ['src/a.ts#run', { path: 'src/a.ts', symbol: 'run' }],
    [
      'services/billing.service.ts#BillingService.charge',
      {
        path: 'services/billing.service.ts',
        symbol: 'BillingService.charge',
      },
    ],
    ['a.ts#$store', { path: 'a.ts', symbol: '$store' }],
  ])('reads %s', (text, expected) => {
    expect(parseAnchoredPath(text)).toEqual(expected)
    expect(formatAnchoredPath(expected)).toBe(text)
  })

  it.each([
    'src/a.ts',
    'src/a.ts:12',
    'src/a.ts#',
    '#run',
    'a b.ts#run',
    'a.ts#1run',
    'a.ts#run.',
  ])('refuses %s', text => {
    expect(parseAnchoredPath(text)).toBeNull()
  })
})

describe('readAnchors', () => {
  it('ignores anything but a map', () => {
    expect(readAnchors(undefined)).toEqual({})
    expect(readAnchors(['a.ts#run'])).toEqual({})
    expect(readAnchors('a.ts#run')).toEqual({})
  })

  it('drops malformed lines but keeps the anchor', () => {
    expect(
      readAnchors({
        'a.ts#run': {
          fingerprint: 'sha256:0123456789abcdef',
          lines: { count: 0, fingerprint: 'sha256:0123456789abcdef' },
        },
        'a.ts#stop': {
          fingerprint: 'sha256:0123456789abcdef',
          lines: { count: 2, fingerprint: 'sha256:XYZ' },
        },
      })
    ).toEqual({
      'a.ts#run': { fingerprint: 'sha256:0123456789abcdef', lines: null },
      'a.ts#stop': { fingerprint: 'sha256:0123456789abcdef', lines: null },
    })
  })

  it('drops an entry without a valid fingerprint', () => {
    expect(
      readAnchors({
        'a.ts#run': {},
        'a.ts#stop': { fingerprint: 'sha256:0123456789ABCDEF' },
        'a.ts#go': { fingerprint: 'sha256:0123' },
      })
    ).toEqual({})
  })
})
