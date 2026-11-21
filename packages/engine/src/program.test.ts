import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { programPath } from './program.ts'

const folder = mkdtempSync(join(tmpdir(), 'compadr-path-'))
mkdirSync(join(folder, 'bin'))
writeFileSync(join(folder, 'bin', 'tool.exe'), '')

afterAll(() => rmSync(folder, { recursive: true, force: true }))

describe('programPath', () => {
  it('keeps the name outside Windows', () => {
    expect(programPath('tool', 'linux', join(folder, 'bin'))).toBe('tool')
  })

  it('reads the program from the absolute folders of PATH on Windows', () => {
    const path = ['bin', '', `"${join(folder, 'bin')}"`].join(delimiter)
    expect(programPath('tool', 'win32', path)).toBe(
      join(folder, 'bin', 'tool.exe')
    )
  })

  it('refuses on Windows a program that PATH does not hold', () => {
    expect(() => programPath('absent', 'win32', join(folder, 'bin'))).toThrow(
      expect.objectContaining({ code: 'ENOENT' })
    )
  })
})
