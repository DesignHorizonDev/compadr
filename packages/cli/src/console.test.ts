import { describe, expect, it } from 'vitest'
import {
  ProgramNotFoundError,
  type ProgramLauncher,
} from './console-command.ts'
import { main } from './main.ts'

async function run(argv: string[], launch: ProgramLauncher) {
  const err: string[] = []
  const code = await main(
    argv,
    { out: () => {}, err: line => err.push(line) },
    { launch }
  )
  return { code, err: err.join('\n') }
}

describe('compadr console', () => {
  it('runs compadr-console with the same arguments and exit code', async () => {
    const calls: [string, readonly string[]][] = []
    const { code } = await run(
      ['console', 'repo', '--port', '4100'],
      (program, args) => {
        calls.push([program, args])
        return Promise.resolve(3)
      }
    )
    expect(code).toBe(3)
    expect(calls).toEqual([['compadr-console', ['repo', '--port', '4100']]])
  })

  it('explains how to install the console when it is missing', async () => {
    const { code, err } = await run(['console', 'repo'], program =>
      Promise.reject(new ProgramNotFoundError(program))
    )
    expect(code).toBe(1)
    expect(err).toBe(
      'compadr console: compadr-console is not installed: install @compadr/console next to @compadr/cli'
    )
  })
})
