// The path of a program that Compadr runs, such as git or gh. On Windows, a
// program named without a path is looked for in the current folder before
// PATH: a git.exe at the root of an analysed repository would then run in
// place of git. The path is read from PATH alone, once per program.
import { existsSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

const found = new Map<string, string>()

/**
 * The executable of `name` in the folders of PATH, on Windows; elsewhere,
 * the name itself. On Windows, a program that PATH does not hold is an
 * error with the code ENOENT, as a missing program is: the bare name would
 * be looked for in the current folder.
 */
export function programPath(
  name: string,
  platform: NodeJS.Platform = process.platform,
  path: string | undefined = process.env.PATH ?? process.env.Path
): string {
  if (platform !== 'win32') return name
  const known = found.get(name)
  if (known !== undefined) return known
  for (const entry of (path ?? '').split(delimiter)) {
    // A folder of PATH may be quoted; a relative one is read from the
    // current folder, and is left out.
    const folder = entry.trim().replace(/^"(.*)"$/, '$1')
    if (folder === '' || !isAbsolute(folder)) continue
    const file = join(folder, `${name}.exe`)
    if (existsSync(file)) {
      found.set(name, file)
      return file
    }
  }
  throw Object.assign(new Error(`${name} is not in PATH`), { code: 'ENOENT' })
}
