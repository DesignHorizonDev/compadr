// `compadr console`: starts the console program of @compadr/console. The
// console is under another license (FCL), so the command line never imports
// it: it runs the program that the package installs, as a separate process.
import { spawn } from 'node:child_process'

export const CONSOLE_PROGRAM = 'compadr-console'

/** Runs a program with the standard streams of this one, then its exit code. */
export type ProgramLauncher = (
  program: string,
  args: readonly string[]
) => Promise<number>

export class ProgramNotFoundError extends Error {}

export const launchProgram: ProgramLauncher = (program, args) =>
  new Promise((done, fail) => {
    const child = spawn(program, [...args], { stdio: 'inherit' })
    child.once('error', error =>
      fail(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new ProgramNotFoundError(program)
          : error
      )
    )
    // A signal that stops the console stops it too: Ctrl-C ends both.
    child.once('exit', (code, signal) =>
      done(code ?? (signal === null ? 1 : 128))
    )
  })
