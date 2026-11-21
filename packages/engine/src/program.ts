// The path of a program that Compadr runs, such as git or gh. On Windows, a
// program named without a path is looked for in the current folder before
// PATH: a git.exe at the root of an analysed repository would then run in
// place of git. The path is read from PATH alone, once per program.
import { existsSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

const found = new Map<string, string>()

/**
 * The executable of `name` in the folders of PATH, on Windows. Elsewhere,
 * and when PATH has no such file, the name itself: the system then reports
 * the missing program as before.
 */
export function programPath(
  name: string,
  platform: NodeJS.Platform = process.platform,
  path: string | undefined = process.env.PATH ?? process.env.Path
): string {
  if (platform !== 'win32') return name
  const known = found.get(name)
  if (known !== undefined) return known
  let program = name
  for (const folder of (path ?? '').split(delimiter)) {
    // A relative folder of PATH is read from the current folder too.
    if (folder === '' || !isAbsolute(folder)) continue
    const file = join(folder, `${name}.exe`)
    if (existsSync(file)) {
      program = file
      break
    }
  }
  found.set(name, program)
  return program
}
