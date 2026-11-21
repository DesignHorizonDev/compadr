// Named declarations of a source file, read with tree-sitter. They anchor a
// reference on a symbol (`file.ts#Class.method`) instead of a line number.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Language, Parser, type Node } from 'web-tree-sitter'

export interface CodeSymbol {
  /** Qualified name: the names of the enclosing declarations, joined by dots. */
  name: string
  /** Type of the tree-sitter node: `function_declaration`, `method_definition`… */
  kind: string
  /** First and last lines, 1-based. */
  start: number
  end: number
  text: string
}

/** Grammar of each file extension that the engine reads. */
const GRAMMARS = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
} as const satisfies Record<string, string>

type Grammar = (typeof GRAMMARS)[keyof typeof GRAMMARS]

// Declarations that carry a name. A `const a = …` is a lexical_declaration
// around a variable_declarator: only the declarator counts, once.
const NAMED = new Set([
  'function_declaration',
  'generator_function_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'method_definition',
  'abstract_method_signature',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'internal_module',
  'variable_declarator',
  'public_field_definition',
  'field_definition',
])

// Outside the top level of a module or a namespace, a variable is a symbol
// only when its value is a function or a class: `const retry = () => …` is
// worth an anchor, `const total = a + b` in a block is not.
const DEFINITIONS = new Set([
  'arrow_function',
  'function_expression',
  'generator_function',
  'class',
])

/** Path of a `.wasm` file: the tree-sitter runtime or a grammar. */
export type LocateWasm = (file: string) => string

// Not named `require`: the command line bundle declares its own.
const installed = createRequire(import.meta.url)

/** Finds the `.wasm` files in the installed packages. */
export const locateInstalledWasm: LocateWasm = file =>
  file === 'web-tree-sitter.wasm'
    ? installed.resolve('web-tree-sitter/web-tree-sitter.wasm')
    : installed.resolve(`@vscode/tree-sitter-wasm/wasm/${file}`)

/** The grammar of a file, or null when the engine does not read its language. */
export function grammarOf(path: string): Grammar | null {
  const dot = path.lastIndexOf('.')
  if (dot <= path.lastIndexOf('/')) return null
  const extension = path.slice(dot + 1).toLowerCase()
  return extension in GRAMMARS
    ? GRAMMARS[extension as keyof typeof GRAMMARS]
    : null
}

/**
 * `sha256:` and the first 16 hex digits of the SHA-256 of the text, once each
 * run of white space is one space and the ends are trimmed. Indentation and
 * line breaks do not change a fingerprint.
 */
export function fingerprint(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return `sha256:${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`
}

/** True for a variable declared at the top level of a module or a namespace. */
function isTopLevel(declarator: Node): boolean {
  let scope = declarator.parent?.parent ?? null
  if (scope?.type === 'export_statement') scope = scope.parent
  if (scope?.type === 'program') return true
  return (
    scope?.type === 'statement_block' &&
    scope.parent?.type === 'internal_module'
  )
}

function hasKeyword(node: Node, keyword: string): boolean {
  return node.children.some(child => child?.type === keyword)
}

const isAccessor = (node: Node) =>
  node.type === 'method_definition' &&
  (hasKeyword(node, 'get') || hasKeyword(node, 'set'))

/**
 * How the members of a class body are named. A getter and a setter of the
 * same property form one symbol. A static member that shares the name of an
 * instance member is named `Class.static.member`.
 */
function classMembers(body: Node) {
  const members = body.namedChildren.filter(
    (child): child is Node => child !== null && NAMED.has(child.type)
  )
  const instanceNames = new Set(
    members
      .filter(member => !hasKeyword(member, 'static'))
      .map(nameOf)
      .filter(name => name !== null)
  )
  const accessors = new Map<string, Node[]>()
  for (const member of members.filter(isAccessor)) {
    const key = `${hasKeyword(member, 'static')}:${nameOf(member)}`
    accessors.set(key, [...(accessors.get(key) ?? []), member])
  }
  return {
    segments(member: Node, name: string): string[] {
      return hasKeyword(member, 'static') && instanceNames.has(name)
        ? ['static', name]
        : [name]
    },
    /** The accessors of a property, when `member` is the first of several. */
    pair(member: Node): Node[] | null {
      if (!isAccessor(member)) return null
      const group = accessors.get(
        `${hasKeyword(member, 'static')}:${nameOf(member)}`
      )
      return group !== undefined && group.length > 1 ? group : null
    },
  }
}

function nameOf(node: Node): string | null {
  const name = node.childForFieldName('name')
  // `const { a, b } = …` has a pattern, not a name.
  if (name === null || !/^[A-Za-z_$][\w$]*$/.test(name.text)) return null
  return name.text
}

/** Reads the named declarations of source files, one parser per process. */
export class SymbolReader {
  private readonly parser: Parser
  private readonly languages: Map<Grammar, Language>

  private constructor(parser: Parser, languages: Map<Grammar, Language>) {
    this.parser = parser
    this.languages = languages
  }

  static async load(locate: LocateWasm = locateInstalledWasm) {
    await Parser.init({ locateFile: (file: string) => locate(file) })
    const languages = new Map<Grammar, Language>()
    for (const grammar of new Set(Object.values(GRAMMARS))) {
      languages.set(
        grammar,
        await Language.load(locate(`tree-sitter-${grammar}.wasm`))
      )
    }
    return new SymbolReader(new Parser(), languages)
  }

  /** Named declarations of a file, outermost first. Null for another language. */
  symbols(path: string, source: string): CodeSymbol[] | null {
    const grammar = grammarOf(path)
    if (grammar === null) return null
    this.parser.setLanguage(this.languages.get(grammar)!)
    const tree = this.parser.parse(source)
    // parse() returns null only when parsing is cancelled, which the engine
    // never asks for.
    if (tree === null) throw new Error(`tree-sitter could not parse ${path}`)
    const symbols: CodeSymbol[] = []
    const walk = (node: Node, scope: string[]) => {
      const members = node.type === 'class_body' ? classMembers(node) : null
      for (const child of node.namedChildren) {
        if (child === null) continue
        const local =
          child.type === 'variable_declarator' &&
          !isTopLevel(child) &&
          !DEFINITIONS.has(child.childForFieldName('value')?.type ?? '')
        const name = NAMED.has(child.type) && !local ? nameOf(child) : null
        if (name === null) {
          walk(child, scope)
          continue
        }
        const inner = [...scope, ...(members?.segments(child, name) ?? [name])]
        const pair = members?.pair(child) ?? null
        // The second accessor of a pair belongs to the symbol of the first.
        if (pair === null || pair[0] === child) {
          const nodes = pair ?? [child]
          symbols.push({
            name: inner.join('.'),
            kind: child.type,
            start: nodes[0]!.startPosition.row + 1,
            end: nodes[nodes.length - 1]!.endPosition.row + 1,
            text: nodes.map(n => n.text).join('\n'),
          })
        }
        walk(child, inner)
      }
    }
    try {
      walk(tree.rootNode, [])
    } finally {
      tree.delete()
    }
    return symbols
  }
}

/** The innermost declaration that contains a line, if any. */
export function symbolAt(
  symbols: readonly CodeSymbol[],
  line: number
): CodeSymbol | undefined {
  let found: CodeSymbol | undefined
  for (const symbol of symbols) {
    if (symbol.start > line || symbol.end < line) continue
    if (
      found === undefined ||
      symbol.end - symbol.start <= found.end - found.start
    ) {
      found = symbol
    }
  }
  return found
}

/**
 * The first line of each run of `count` consecutive lines of `symbol` whose
 * fingerprint is `expected`.
 */
export function matchLines(
  symbol: CodeSymbol,
  count: number,
  expected: string
): number[] {
  const lines = symbol.text.split('\n')
  const starts: number[] = []
  for (let i = 0; i + count <= lines.length; i++) {
    if (fingerprint(lines.slice(i, i + count).join('\n')) === expected) {
      starts.push(symbol.start + i)
    }
  }
  return starts
}

/** The first match of `matchLines`, or null. */
export function findLines(
  symbol: CodeSymbol,
  count: number,
  expected: string
): number | null {
  return matchLines(symbol, count, expected)[0] ?? null
}
