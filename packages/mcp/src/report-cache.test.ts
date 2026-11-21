import {
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import { locateInstalledWasm } from '@compadr/engine'
import { afterAll, describe, expect, it } from 'vitest'
import { KEPT_REPORTS, ReportCache } from './report-cache.ts'

const unavailable = () => {
  throw new Error('grammars unavailable')
}

describe('ReportCache', () => {
  let fixture: FixtureRepo | undefined
  afterAll(() => fixture?.remove())

  it('keeps no failed computation and reuses a report of the same commit', async () => {
    fixture = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-a.md':
            '# 1. A\n\nStatus: accepted\n\nSee `src/a.ts:1`.\n',
          'src/a.ts': 'export function a() {}\n',
        },
      },
    ])
    // The grammars load for the reference that cites a line: the first
    // computation fails there, the next one finds them.
    let fail = true
    const cache = new ReportCache({
      repository: fixture.path,
      ref: 'HEAD',
      generatorVersion: '0.0.0',
      locateWasm: file => {
        if (fail) throw new Error('grammars unavailable')
        return locateInstalledWasm(file)
      },
    })
    await expect(cache.get()).rejects.toThrow('grammars unavailable')
    fail = false
    const report = await cache.get()
    expect(report.repository.ref).toBe('HEAD')
    expect(report.decisions).toHaveLength(1)
    expect(await cache.get()).toBe(report)
  })
})

describe('ReportCache on disk', () => {
  const fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-a.md':
          '# 1. A\n\nStatus: accepted\n\nSee `src/a.ts:1`.\n',
        'src/a.ts': 'export function a() {}\n',
      },
    },
  ])
  const cacheDir = mkdtempSync(join(tmpdir(), 'compadr-cache-'))
  afterAll(() => {
    fixture.remove()
    rmSync(cacheDir, { recursive: true, force: true })
  })
  const options = {
    repository: fixture.path,
    ref: 'HEAD',
    generatorVersion: '0.0.0',
    cacheDir,
  }
  const files = () =>
    readdirSync(cacheDir, { recursive: true, encoding: 'utf8' })
      .filter(name => name.endsWith('.json'))
      .map(name => join(cacheDir, name))

  it('reads the report of a commit already computed, without computing it', async () => {
    const first = await new ReportCache(options).get()
    expect(files()).toHaveLength(1)
    // The grammars are needed for the reference that cites a line: a second
    // server can answer only from the disk.
    const second = await new ReportCache({
      ...options,
      ref: 'main',
      locateWasm: unavailable,
    }).get()
    expect(second).toEqual({
      ...first,
      repository: { ...first.repository, ref: 'main' },
    })
  })

  it('computes again a report that does not match the schema', async () => {
    writeFileSync(files()[0]!, '{"schemaVersion":')
    const cache = new ReportCache({ ...options, locateWasm: unavailable })
    await expect(cache.get()).rejects.toThrow('grammars unavailable')
    const report = await new ReportCache(options).get()
    expect(report.decisions).toHaveLength(1)
  })

  it('does not read a report of another generator version', async () => {
    const cache = new ReportCache({
      ...options,
      generatorVersion: '0.0.1',
      locateWasm: unavailable,
    })
    await expect(cache.get()).rejects.toThrow('grammars unavailable')
  })

  it('keeps the most recent reports only', async () => {
    const [kept] = files()
    const folder = join(kept!, '..')
    for (let i = 0; i < KEPT_REPORTS + 2; i++) {
      const old = join(folder, `${String(i).padStart(40, '0')}-x.json`)
      writeFileSync(old, '{}')
      utimesSync(old, new Date(2020, 0, 1 + i), new Date(2020, 0, 1 + i))
    }
    const stale = join(folder, 'old.json.1.tmp')
    const writing = join(folder, 'new.json.2.tmp')
    writeFileSync(stale, '{')
    writeFileSync(writing, '{')
    utimesSync(stale, new Date(2020, 0, 1), new Date(2020, 0, 1))
    await new ReportCache({ ...options, generatorVersion: '0.0.2' }).get()
    const left = files()
    expect(left).toHaveLength(KEPT_REPORTS)
    expect(left).toContain(kept)
    // Another server may still be writing a recent temporary file.
    expect(readdirSync(folder).filter(name => name.endsWith('.tmp'))).toEqual([
      'new.json.2.tmp',
    ])
  })
})
