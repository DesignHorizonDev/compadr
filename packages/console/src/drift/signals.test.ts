import { describe, expect, it } from 'vitest'
import {
  makeAnchoredReport,
  makeDriftReport,
  makeReport,
} from '../testing/report.ts'
import {
  anchoredShare,
  anchoring,
  countSignals,
  decisionLabel,
  driftRows,
  formatDate,
  indexReport,
  summarizeLevels,
} from './signals.ts'

const index = indexReport(makeDriftReport())
const rows = driftRows(index)
const row = (id: string) => rows.find(candidate => candidate.signal.id === id)!

describe('driftRows', () => {
  it('leaves out the info signals and sorts by level, then by decision', () => {
    expect(rows.map(r => [r.signal.level, r.signal.decision])).toEqual([
      ['broken', 3],
      ['broken', 12],
      ['broken', 36],
      ['broken', 37],
      ['broken', 99],
      ['review', 37],
      ['order', 27],
      ['order', 37],
    ])
  })

  it('describes a reference signal with its target and citation date', () => {
    expect(
      row('cited-file-changed:0037:services/billing.ts:116:1')
    ).toMatchObject({
      title: 'Cited file changed since the citation',
      target: 'services/billing.ts:116',
      note: '7 commits since',
      area: 'server/billing',
      citedAt: '2026-10-04T20:46:49Z',
    })
    expect(row('cited-line-changed:0037:services/search.ts:20:1').target).toBe(
      'services/search.ts:20-30'
    )
    expect(
      row('cited-line-out-of-range:0037:services/short.ts:400:1').note
    ).toBe('the file has 1 line')
    expect(row('path-missing:0012:utils/mail.ts:1')).toMatchObject({
      target: 'utils/mail.ts',
      note: null,
      area: 'Mail',
    })
  })

  it('describes the signals that cite a decision from the code', () => {
    expect(row('superseded-decision-cited:0003:src/a.ts:50')).toMatchObject({
      title: 'Superseded decision still cited in code',
      target: 'src/a.ts:50',
      note: 'replaced by ADR-0027',
      citedAt: null,
    })
    expect(row('unknown-decision-cited:0099:src/b.ts:4')).toMatchObject({
      target: 'src/b.ts:4',
      decision: undefined,
      area: null,
    })
  })

  it('describes the index and linked-files signals', () => {
    expect(row('index-status-mismatch:0036').target).toBe(
      'index: Proposed, record: Accepted'
    )
    expect(row('linked-files-changed:0027')).toMatchObject({
      target: 'src/storage',
      note: 'and 1 file',
      area: 'server/storage',
      citedAt: '2026-10-04T20:46:49Z',
    })
  })
})

describe('describeSignal', () => {
  it('names a linked-files signal without file', () => {
    const report = makeDriftReport()
    const signal = report.signals.find(
      candidate => candidate.type === 'linked-files-changed'
    )!
    if (signal.type === 'linked-files-changed') signal.files = []
    const empty = driftRows(indexReport(report)).find(
      candidate => candidate.signal.id === signal.id
    )!
    expect(empty).toMatchObject({ target: 'no file listed', note: null })
  })
})

describe('anchored references', () => {
  const anchored = driftRows(indexReport(makeAnchoredReport()))

  it('names the symbol of an anchored reference', () => {
    expect(
      anchored.find(
        r =>
          r.signal.id ===
          'anchor-content-changed:0027:src/storage/s3.ts#S3Store.put:1'
      )
    ).toMatchObject({
      title: 'Anchored symbol changed since its fingerprint',
      target: 'src/storage/s3.ts#S3Store.put',
      note: null,
    })
    expect(
      anchored.find(
        r =>
          r.signal.id ===
          'anchor-symbol-ambiguous:0027:src/storage/s3.ts#S3Store.put:1'
      )?.note
    ).toBe('2 matches')
  })

  it('counts the anchor signals with the review level', () => {
    expect(summarizeLevels(anchored)[1]).toMatchObject({ count: 4 })
    expect(
      anchored.find(
        r =>
          r.signal.id ===
          'anchor-symbol-missing:0027:src/storage/s3.ts#S3Store.put:1'
      )
    ).toMatchObject({
      title: 'Anchored symbol no longer exists',
      target: 'src/storage/s3.ts#S3Store.put',
    })
    expect(
      anchored.find(
        r =>
          r.signal.id ===
          'anchor-lines-changed:0027:src/storage/s3.ts#S3Store.put:1'
      )?.title
    ).toBe('Tracked lines no longer found in the symbol')
    expect(countSignals('anchor-content-changed', 1)).toBe('1 changed symbol')
  })
})

describe('summarizeLevels', () => {
  it('counts each level and its types', () => {
    expect(summarizeLevels(rows)).toEqual([
      {
        level: 'broken',
        count: 5,
        types: [
          { type: 'cited-line-out-of-range', count: 1 },
          { type: 'index-status-mismatch', count: 1 },
          { type: 'path-missing', count: 1 },
          { type: 'superseded-decision-cited', count: 1 },
          { type: 'unknown-decision-cited', count: 1 },
        ],
      },
      {
        level: 'review',
        count: 1,
        types: [{ type: 'cited-line-changed', count: 1 }],
      },
      {
        level: 'order',
        count: 2,
        types: [
          { type: 'cited-file-changed', count: 1 },
          { type: 'linked-files-changed', count: 1 },
        ],
      },
    ])
  })

  it('counts nothing for a report without signal', () => {
    const empty = summarizeLevels(driftRows(indexReport(makeReport())))
    expect(empty.map(level => level.count)).toEqual([0, 0, 0])
  })
})

describe('formatting', () => {
  it('counts the path links and their anchors', () => {
    expect(anchoring(makeDriftReport())).toEqual({ paths: 4, anchored: 0 })
  })

  it('rounds the anchored share down', () => {
    expect(anchoredShare({ paths: 0, anchored: 0 })).toBe('–')
    expect(anchoredShare({ paths: 1000, anchored: 999 })).toBe('99 %')
    expect(anchoredShare({ paths: 4, anchored: 4 })).toBe('100 %')
  })

  it('writes the counts in the singular and the plural', () => {
    expect(countSignals('path-missing', 1)).toBe('1 missing path')
    expect(countSignals('path-missing', 32)).toBe('32 missing paths')
    expect(countSignals('index-status-mismatch', 2)).toBe('2 index mismatches')
  })

  it('writes dates in UTC and decision numbers on four digits', () => {
    expect(formatDate('2026-10-04T23:30:00Z')).toBe('Oct 4, 2026')
    expect(decisionLabel(37)).toBe('ADR-0037')
  })
})
