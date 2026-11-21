import {
  checkedLines,
  COMPADR_CONFIG,
  decisionRule,
  FEATURE_GLOSSARY,
  parseAdr,
  parseAdrIndex,
  parseCompadrConfig,
  parseFeatureGlossary,
  readDecisionText,
  type AdrCitation,
  type Attribution,
  type CodeReference,
  type CompadrConfig,
  type Decision,
  type FeatureGlossary,
  type QuotedRule,
} from '@compadr/format'
import { forEachGitLine, runGit } from './git.ts'
import { extractReferences, resolvePath } from './references.ts'
import type { Repository } from './repository.ts'

/** What the engine reads in a repository before computing the signals. */
export interface Corpus {
  adrDir: string
  decisions: Decision[]
  references: CodeReference[]
  /** Citations of a decision outside the ADR folder. */
  citations: AdrCitation[]
  /** Status of each decision in the ADR index, as written there. */
  indexStatuses: Map<number, string>
  /** Commit that wrote the line of each reference in its record (git blame). */
  citedIn: Map<string, string>
  /** Text of each record, by decision number. */
  records: Map<number, string>
  /** Rules of older decisions that each decision quotes as replaced. */
  quotedRules: Map<number, QuotedRule[]>
  /** The glossary of the features, empty when the folder has none. */
  glossary: FeatureGlossary
  /** The settings of `compadr.yml`, or their defaults. */
  config: CompadrConfig
}

// `git grep -E` has no `\b`: the search finds the candidate lines, and
// ADR_CITATION checks the boundaries on each of them.
const ADR_CITATION_SEARCH = 'ADR[- _]?[0-9]{1,4}|adr/[0-9]{4}'
// "ADR-0012", "ADR 12", "adr_12", "adr/0012", but neither "quadr12" nor
// "ADR-12345".
const ADR_CITATION =
  /(?<![A-Za-z0-9])(?:ADR[- _]?([0-9]{1,4})|adr\/([0-9]{4}))(?![0-9])/gi
// Markdown and text files are documentation, not code.
const NOT_CODE = [':(exclude)*.md', ':(exclude)*.mdx', ':(exclude)*.txt']
const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]+'
// Third-party or generated code, left out of the searches.
const THIRD_PARTY = [
  ':(exclude).yarn/**',
  ':(exclude)**/vendor/**',
  ':(exclude)**/*.min.js',
  ':(exclude)**/*.lock',
  ':(exclude)**/package-lock.json',
]
// Generated code repeats the declarations of its sources: a Prisma model
// comes back as a GraphQL type and a TypeScript type.
const GENERATED = [
  ':(exclude)**/*.graphql',
  ':(exclude)**/gql/**',
  ':(exclude)**/generated/**',
  ':(exclude)**/__generated__/**',
  ':(exclude)**/*.generated.*',
]
// A declaration at the start of a line: `export async function name`,
// `class Name`, `type Name`, `const NAME`, `const enum Name`, `model Name` (Prisma), `def name`
// (Python), `func name` (Go), `pub fn name` (Rust). An indented line is left
// out: a local variable often bears the name of a field.
const DECLARATION =
  '^(export[[:space:]]+)?(default[[:space:]]+)?(pub[[:space:]]+)?(declare[[:space:]]+)?(async[[:space:]]+)?(abstract[[:space:]]+)?(const[[:space:]]+enum|function[*]?|class|interface|type|enum|const|let|var|def|fn|func|struct|trait|model)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*'
const DECLARED_NAME =
  /^(?:export\s+)?(?:default\s+)?(?:pub\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:const\s+enum|function\*?|class|interface|type|enum|const|let|var|def|fn|func|struct|trait|model)\s+([A-Za-z_$][\w$]*)/

// Folders that say little about the area of the code.
const GENERIC_FOLDERS = new Set(['src', 'lib', 'app', 'packages'])
const CONCURRENCY = 8

/**
 * Line (from 1) where `text` declares `name` at the start of a line, as the
 * engine finds a declaration: `export function name`, `class Name`. Returns
 * null when no line declares it.
 */
export function declarationLine(text: string, name: string): number | null {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (DECLARED_NAME.exec(lines[i]!)?.[1] === name) return i + 1
  }
  return null
}

/** False for Markdown and text files, which are documentation. */
export function isCode(file: string): boolean {
  return !/\.(?:md|mdx|txt)$/i.test(file)
}

/** Numbers of the decisions that a line of a file cites, as the engine reads them. */
export function citedDecisions(line: string): number[] {
  return [...line.matchAll(ADR_CITATION)]
    .map(match => Number(match[1] ?? match[2]))
    .filter(number => number > 0)
}

/** The first two meaningful folders of a file: `server/db`, `web/editor`. */
export function codeArea(file: string): string {
  const folders = file
    .split('/')
    .slice(0, -1)
    .filter(folder => !GENERIC_FOLDERS.has(folder))
  return folders.slice(0, 2).join('/') || '(root)'
}

function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: string | null = null
  for (const [value, count] of counts) {
    if (best === null || count > counts.get(best)!) best = value
  }
  return best
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  return results
}

/** Citations of a decision in the tracked files outside the ADR folder. */
export async function findCitations(
  repo: Repository,
  adrDir: string
): Promise<AdrCitation[]> {
  const output = await runGit(
    repo.path,
    'grep',
    [
      '-n',
      '-z',
      '-I',
      '-E',
      '-i',
      ADR_CITATION_SEARCH,
      repo.commit,
      '--',
      '.',
      `:(exclude)${adrDir}/**`,
      ...THIRD_PARTY,
    ],
    { okExitCodes: [1] }
  )
  const citations: AdrCitation[] = []
  for (const row of output.split('\n')) {
    if (row === '') continue
    // <commit>:<file>\0<line>\0<content>
    const [location, line, ...content] = row.split('\0')
    const file = location!.slice(location!.indexOf(':') + 1)
    // "ADR-00NN" in a template reads as 0, which citedDecisions leaves out.
    for (const number of citedDecisions(content.join('\0'))) {
      citations.push({
        file,
        line: Number(line),
        decision: number,
        inCode: isCode(file),
      })
    }
  }
  return citations
}

/**
 * Symbols among `symbols` that appear in the code, outside Markdown and text
 * files and the ADR folder. One pass lists every identifier of two characters
 * or more, the shortest symbol a record can cite. The output is read line by
 * line and only the cited symbols are kept.
 */
export async function findSymbolsInCode(
  repo: Repository,
  adrDir: string,
  symbols: ReadonlySet<string>
): Promise<Set<string>> {
  const found = new Set<string>()
  if (symbols.size === 0) return found
  await forEachGitLine(
    repo.path,
    'grep',
    [
      '-h',
      '-o',
      '-I',
      '-E',
      IDENTIFIER,
      repo.commit,
      '--',
      '.',
      ...NOT_CODE,
      `:(exclude)${adrDir}/**`,
      ...THIRD_PARTY,
    ],
    identifier => {
      if (symbols.has(identifier)) found.add(identifier)
    },
    { okExitCodes: [1] }
  )
  return found
}

/**
 * Where each symbol of `symbols` is declared at the start of a line, in the
 * code outside `adrDir`, generated and third-party code aside.
 */
export async function findDeclarations(
  repo: Repository,
  adrDir: string,
  symbols: ReadonlySet<string>
): Promise<Map<string, { file: string; line: number }[]>> {
  const found = new Map<string, { file: string; line: number }[]>()
  if (symbols.size === 0) return found
  const prefix = `${repo.commit}:`
  await forEachGitLine(
    repo.path,
    'grep',
    [
      '-n',
      '-I',
      '-E',
      DECLARATION,
      repo.commit,
      '--',
      '.',
      ...NOT_CODE,
      `:(exclude)${adrDir}/**`,
      ...THIRD_PARTY,
      ...GENERATED,
    ],
    output => {
      if (!output.startsWith(prefix)) return
      const match = /^(.*?):(\d+):(.*)$/.exec(output.slice(prefix.length))
      if (match === null) return
      const name = DECLARED_NAME.exec(match[3]!)?.[1]
      if (name === undefined || !symbols.has(name)) return
      const file = match[1]!
      const list = found.get(name) ?? []
      // One file declares a symbol once, however many overloads it has.
      if (!list.some(entry => entry.file === file)) {
        list.push({ file, line: Number(match[2]) })
      }
      found.set(name, list)
    },
    { okExitCodes: [1] }
  )
  return found
}

/**
 * Reads the decisions of `adrDir`, their references to the code, the
 * citations of decisions in the repository and the ADR index, all at the
 * commit of `repo`.
 *
 * Each reference is dated by the writing of its own line in the record (git
 * blame): a note added later to the record does not make an old reference
 * look recent. When two files carry the same number, the first one in path
 * order is kept.
 */
export async function readCorpus(
  repo: Repository,
  adrDir = 'docs/adr'
): Promise<Corpus> {
  const dir = adrDir.replace(/\/+$/, '')
  const files = [...repo.files].filter(f => f.startsWith(`${dir}/`)).sort()

  const read = await mapWithLimit(files, CONCURRENCY, async file => {
    // git blame splits lines on \n only: a lone \r stays inside its line, so
    // that the lines of the record and of the blame keep the same numbers.
    const markdown = (await repo.read(file)).replace(/\r\n/g, '\n')
    const document = parseAdr(file, markdown)
    if (document === null) return null
    const extracted = extractReferences(markdown, repo.folderNames)
    const [origins, revisedAt, history, addedBy] = await Promise.all([
      extracted.length > 0 ? repo.lineOrigins(file) : [],
      repo.lastChange(file),
      repo.fileHistory(file),
      // A record that names its deciders needs no author from git.
      document.deciders.length > 0 ? null : repo.addedBy(file),
    ])
    return {
      file,
      markdown,
      document,
      extracted,
      origins,
      revisedAt,
      history,
      addedBy,
    }
  })

  const seen = new Set<number>()
  const records = read.filter(record => {
    if (record === null || seen.has(record.document.number)) return false
    seen.add(record.document.number)
    return true
  }) as NonNullable<(typeof read)[number]>[]

  const references: CodeReference[] = []
  const citedIn = new Map<string, string>()
  const symbolReferences: Extract<CodeReference, { kind: 'symbol' }>[] = []
  for (const { document, markdown, extracted: found, origins } of records) {
    const entryLines = checkedLines(markdown)
    // Who checked: the name of the entry, or the author of its line.
    const checkedBy = (text: string): Attribution | null => {
      const by = document.checked[text]!.by
      if (by !== null) return { names: [by], source: 'declared' }
      const line = entryLines.get(text)
      const origin = line === undefined ? undefined : origins[line - 1]
      return origin === undefined || origin.author === ''
        ? null
        : { names: [origin.author], source: 'commit', commit: origin.commit }
    }
    const checkedFields = (text: string) => {
      const by = checkedBy(text)
      return {
        checkedAt: document.checked[text]!.at,
        ...(by === null ? {} : { checkedBy: by }),
      }
    }
    const prefix = String(document.number).padStart(4, '0')
    // The identifier leaves out the line, which moves when the record is
    // edited: the rank tells apart the citations of one text.
    const ranks = new Map<string, number>()
    for (const extracted of found) {
      const origin = origins[extracted.adrLine - 1]
      const rank = (ranks.get(extracted.text) ?? 0) + 1
      ranks.set(extracted.text, rank)
      const base = {
        id: `${prefix}:${extracted.text}:${rank}`,
        decision: document.number,
        adrLine: extracted.adrLine,
        column: extracted.column,
        text: extracted.text,
        citedAt: origin?.date ?? null,
        // Only a checked reference carries the fields.
        ...(Object.hasOwn(document.checked, extracted.text)
          ? checkedFields(extracted.text)
          : {}),
      }
      if (origin) citedIn.set(base.id, origin.commit)
      if (extracted.kind === 'path') {
        references.push({
          kind: 'path',
          ...base,
          path: extracted.path,
          lines: extracted.lines,
          resolvedPaths: resolvePath(repo, extracted.path),
          anchor:
            extracted.symbol === null
              ? null
              : {
                  symbol: extracted.symbol,
                  fingerprint:
                    document.anchors[extracted.text]?.fingerprint ?? null,
                  lines: document.anchors[extracted.text]?.lines ?? null,
                },
        })
      } else {
        const reference = {
          kind: 'symbol' as const,
          ...base,
          symbol: extracted.symbol,
          foundInCode: false,
        }
        symbolReferences.push(reference)
        references.push(reference)
      }
    }
  }

  const citedSymbols = new Set(
    symbolReferences.map(reference => reference.symbol)
  )
  const [citations, symbolsInCode, declarations, indexStatuses] =
    await Promise.all([
      findCitations(repo, dir),
      findSymbolsInCode(repo, dir, citedSymbols),
      findDeclarations(repo, dir, citedSymbols),
      repo.files.has(`${dir}/README.md`)
        ? repo.read(`${dir}/README.md`).then(parseAdrIndex)
        : Promise.resolve(new Map<number, string>()),
    ])
  const glossary = repo.files.has(`${dir}/${FEATURE_GLOSSARY}`)
    ? parseFeatureGlossary(await repo.read(`${dir}/${FEATURE_GLOSSARY}`))
    : { features: [], problems: [] }
  const config = parseCompadrConfig(
    repo.files.has(`${dir}/${COMPADR_CONFIG}`)
      ? await repo.read(`${dir}/${COMPADR_CONFIG}`)
      : ''
  )
  const texts = new Map(
    records.map(({ document, markdown }) => [
      document.number,
      readDecisionText(markdown),
    ])
  )
  for (const reference of symbolReferences) {
    reference.foundInCode = symbolsInCode.has(reference.symbol)
    const declared = declarations.get(reference.symbol)
    if (declared !== undefined) {
      reference.declaredIn = [...declared].sort(
        (a, b) => a.file.localeCompare(b.file) || a.line - b.line
      )
    }
  }

  const decisions: Decision[] = records.map(
    ({ file, document, revisedAt, history, addedBy }) => {
      // The area comes from each citation of the decision in the code, then
      // from each distinct file or folder that the decision cites.
      const cited = new Set(
        references.flatMap(r =>
          r.decision === document.number && r.kind === 'path'
            ? r.resolvedPaths
            : []
        )
      )
      // A cited folder counts for itself, not for its parent.
      const areas = [
        ...citations
          .filter(c => c.decision === document.number && c.inCode)
          .map(c => codeArea(c.file)),
        ...[...cited]
          .filter(path => !path.startsWith(`${dir}/`))
          .map(path => codeArea(repo.folders.has(path) ? `${path}/` : path)),
      ]
      return {
        number: document.number,
        file,
        title: document.title,
        status: document.status,
        rawStatus: document.rawStatus,
        date: document.date,
        revisedAt,
        history,
        lineCount: document.lineCount,
        feature: document.feature,
        parent: document.parent,
        amends: document.amends,
        amendedBy: document.amendedBy,
        supersededBy: document.supersededBy,
        codeArea: mostCommon(areas),
        ...(document.deciders.length > 0
          ? {
              attribution: {
                names: document.deciders,
                source: 'declared' as const,
              },
            }
          : addedBy && addedBy.author !== ''
            ? {
                attribution: {
                  names: [addedBy.author],
                  source: 'commit' as const,
                  commit: addedBy.commit,
                },
              }
            : {}),
        text: {
          relations: texts.get(document.number)!.relations,
          sections: texts.get(document.number)!.sections,
        },
        rule: decisionRule(document.rule, texts.get(document.number)!.sections),
      }
    }
  )

  return {
    adrDir: dir,
    decisions,
    references,
    citations,
    indexStatuses,
    citedIn,
    records: new Map(
      records.map(({ document, markdown }) => [document.number, markdown])
    ),
    quotedRules: new Map(
      [...texts].map(([number, text]) => [number, text.replaces])
    ),
    glossary,
    config,
  }
}
