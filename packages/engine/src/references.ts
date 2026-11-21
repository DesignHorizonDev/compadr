import { parseAnchoredPath } from '@compadr/format'
import type { Repository } from './repository.ts'

export interface ExtractedPath {
  kind: 'path'
  /** Text between the backticks. */
  text: string
  path: string
  lines: { start: number; end: number } | null
  /** Symbol named after the path: `file.ts#Class.method`. */
  symbol: string | null
  /** Line of the record (1-based). */
  adrLine: number
  /** Column of the opening backtick (1-based). */
  column: number
}

export interface ExtractedSymbol {
  kind: 'symbol'
  text: string
  symbol: string
  adrLine: number
  column: number
}

export type ExtractedReference = ExtractedPath | ExtractedSymbol

const CODE_SPAN = /`([^`\n]{2,200})`/g
// URLs, shell variables, options, absolute or home paths, npm scopes and
// environment files. `httpClient` is a symbol, not a URL.
const SKIPPED_PREFIXES = [
  'http://',
  'https://',
  '$',
  '-',
  '/',
  '~',
  '@',
  '.env',
]
const SKIPPED_CHARACTERS = /[*{}<>…]/
// "file.ts", "file.ts:120", "file.ts:120-140".
const PATH_AND_LINES = /^(.+?)(?::(\d+)(?:[-–](\d+))?)?$/
// Segments of built or untracked files, never in git.
const IGNORED_SEGMENTS = new Set([
  'dist',
  'build',
  'generated',
  'node_modules',
  'refs',
  '.claude',
  'coverage',
])
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'go', 'rs',
  'java', 'kt', 'swift', 'rb', 'php', 'cs', 'sql', 'prisma', 'graphql', 'gql',
  'json', 'yaml', 'yml', 'toml', 'sh', 'css', 'scss', 'html', 'md', 'mdx',
  'env', 'conf', 'caddy', 'dockerfile',
]) // prettier-ignore
// camelCase, PascalCase with two humps, or UPPER_SNAKE_CASE.
const SYMBOL =
  /^(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[A-Z][A-Z0-9]*_[A-Z0-9_]+)$/

function classify(
  raw: string,
  folderNames: ReadonlySet<string>
): Omit<ExtractedPath, 'adrLine' | 'column'> | { symbol: string } | null {
  const text = raw.trim()
  if (text.includes(' ') || SKIPPED_PREFIXES.some(p => text.startsWith(p))) {
    return null
  }
  if (SKIPPED_CHARACTERS.test(text)) return null
  const anchored = parseAnchoredPath(text)
  const [, rawPath, start, end] = anchored
    ? [text, anchored.path, undefined, undefined]
    : PATH_AND_LINES.exec(text)!
  // "./server/x.ts" and "../../server/x.ts" name the same tracked path.
  // ".github/x.yml" keeps its dot.
  const path = rawPath.replace(/^(?:\.\.?\/)+/, '').replace(/\/+$/, '')
  if (path === '' || path.includes(':')) return null
  const segments = path.split('/')
  if (segments.some(segment => IGNORED_SEGMENTS.has(segment))) return null
  const last = segments[segments.length - 1]!
  // A leading dot starts a name, not an extension: `.md` alone is not a file.
  const extension =
    last.lastIndexOf('.') > 0
      ? last.slice(last.lastIndexOf('.') + 1).toLowerCase()
      : ''
  if (
    CODE_EXTENSIONS.has(extension) ||
    (segments.length > 1 && folderNames.has(segments[0]!))
  ) {
    const lines =
      start === undefined
        ? null
        : { start: Number(start), end: Number(end ?? start) }
    return { kind: 'path', text, path, lines, symbol: anchored?.symbol ?? null }
  }
  // An anchor on something that is not a path is not a reference.
  if (anchored) return null
  const symbol = text.replace(/\(\)$/, '')
  return SYMBOL.test(symbol) ? { symbol } : null
}

/**
 * Finds the references to the code cited between backticks in a record.
 *
 * A text with a slash counts as a path only when it carries a known extension
 * or starts with a folder name of the repository: this rules out routes
 * (`/login`), alternatives (`try/catch`) and placeholders. Identifiers in
 * camelCase, PascalCase or UPPER_SNAKE_CASE count as symbols, once per
 * record.
 */
export function extractReferences(
  markdown: string,
  folderNames: ReadonlySet<string>
): ExtractedReference[] {
  const references: ExtractedReference[] = []
  const symbols = new Set<string>()
  markdown.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(CODE_SPAN)) {
      const found = classify(match[1]!, folderNames)
      if (found === null) continue
      const position = { adrLine: index + 1, column: match.index + 1 }
      if ('kind' in found) {
        references.push({ ...found, ...position })
      } else if (!symbols.has(found.symbol)) {
        symbols.add(found.symbol)
        references.push({
          kind: 'symbol',
          text: match[1]!.trim(),
          symbol: found.symbol,
          ...position,
        })
      }
    }
  })
  return references
}

/**
 * Tracked files or folders that match a cited path. An exact match wins.
 * Otherwise a file name alone (`MindmapGraph.tsx`) or a partial path matches
 * every tracked path that ends with it.
 */
export function resolvePath(repo: Repository, path: string): string[] {
  if (repo.files.has(path) || repo.folders.has(path)) return [path]
  const suffix = `/${path}`
  const name = path.slice(path.lastIndexOf('/') + 1)
  const files = repo.filesNamed(name).filter(file => file.endsWith(suffix))
  if (files.length > 0) return files.sort()
  return repo
    .foldersNamed(name)
    .filter(folder => folder.endsWith(suffix))
    .sort()
}
