// Anchored references: the checks of `path#Symbol` references, and the anchor
// proposed for each reference that still cites a line number.
import type { AnchorProposal, CodeReference, Signal } from '@compadr/format'
import type { Corpus } from './read-corpus.ts'
import type { Repository } from './repository.ts'
import {
  findLines,
  fingerprint,
  matchLines,
  symbolAt,
  type CodeSymbol,
  type SymbolReader,
} from './symbols.ts'

type SignalOf<T extends Signal['type']> = Extract<Signal, { type: T }>
type PathReference = Extract<CodeReference, { kind: 'path' }>

/** The single tracked file that a path reference names, if any. */
function fileOf(repo: Repository, reference: PathReference): string | null {
  const [file, ...others] = reference.resolvedPaths
  return file !== undefined && others.length === 0 && repo.files.has(file)
    ? file
    : null
}

/** Symbols of the files, each file read and parsed once per commit. */
export interface SymbolIndex {
  /** Symbols at the analysed commit. Null for a language the engine does not read. */
  current(file: string): Promise<CodeSymbol[] | null>
  /** Source and symbols at another commit. Null when the file did not exist there. */
  at(commit: string, file: string): Promise<SourceAt | null>
}

interface SourceAt {
  source: string
  symbols: CodeSymbol[] | null
}

export function symbolIndex(
  repo: Repository,
  reader: SymbolReader
): SymbolIndex {
  const current = new Map<string, Promise<CodeSymbol[] | null>>()
  const past = new Map<string, Promise<SourceAt | null>>()
  return {
    current(file) {
      let symbols = current.get(file)
      if (symbols === undefined) {
        symbols = repo.read(file).then(source => reader.symbols(file, source))
        current.set(file, symbols)
      }
      return symbols
    },
    at(commit, file) {
      const key = `${commit}:${file}`
      let found = past.get(key)
      if (found === undefined) {
        found = repo
          .readAt(commit, file)
          .then(source =>
            source === null
              ? null
              : { source, symbols: reader.symbols(file, source) }
          )
        past.set(key, found)
      }
      return found
    },
  }
}

/**
 * Signals of the anchored references: a symbol that no longer exists, a name
 * that several symbols share, content or tracked lines that changed since
 * their fingerprint, and anchors that the engine cannot check.
 */
export async function anchorSignals(
  repo: Repository,
  corpus: Corpus,
  index: SymbolIndex
): Promise<Signal[]> {
  const signals: Signal[] = []
  for (const reference of corpus.references) {
    if (reference.kind !== 'path' || reference.anchor === null) continue
    // A missing path is already a broken signal.
    const file = fileOf(repo, reference)
    if (file === null) continue
    const { anchor } = reference
    const base = { decision: reference.decision, reference: reference.id }
    const symbols = await index.current(file)
    if (symbols === null) {
      signals.push({
        type: 'anchor-unverified',
        level: 'info',
        id: `anchor-unverified:${reference.id}`,
        ...base,
        reason: 'unsupported-language',
      } satisfies SignalOf<'anchor-unverified'>)
      continue
    }
    const matches = symbols.filter(symbol => symbol.name === anchor.symbol)
    const [symbol] = matches
    if (symbol === undefined) {
      signals.push({
        type: 'anchor-symbol-missing',
        level: 'broken',
        id: `anchor-symbol-missing:${reference.id}`,
        ...base,
      } satisfies SignalOf<'anchor-symbol-missing'>)
      continue
    }
    if (matches.length > 1) {
      signals.push({
        type: 'anchor-symbol-ambiguous',
        level: 'review',
        id: `anchor-symbol-ambiguous:${reference.id}`,
        ...base,
        matches: matches.length,
      } satisfies SignalOf<'anchor-symbol-ambiguous'>)
      continue
    }
    if (anchor.fingerprint === null) {
      signals.push({
        type: 'anchor-unverified',
        level: 'info',
        id: `anchor-unverified:${reference.id}`,
        ...base,
        reason: 'no-fingerprint',
      } satisfies SignalOf<'anchor-unverified'>)
      continue
    }
    const current = fingerprint(symbol.text)
    if (current !== anchor.fingerprint) {
      signals.push({
        type: 'anchor-content-changed',
        level: 'review',
        id: `anchor-content-changed:${reference.id}`,
        ...base,
        currentFingerprint: current,
      } satisfies SignalOf<'anchor-content-changed'>)
    }
    if (
      anchor.lines !== null &&
      findLines(symbol, anchor.lines.count, anchor.lines.fingerprint) === null
    ) {
      signals.push({
        type: 'anchor-lines-changed',
        level: 'review',
        id: `anchor-lines-changed:${reference.id}`,
        ...base,
      } satisfies SignalOf<'anchor-lines-changed'>)
    }
  }
  return signals
}

/**
 * The anchor proposed for each path reference that cites lines, keyed by
 * reference. The symbol is the innermost declaration that contained the
 * first cited line when the record cited it. It must exist once at the
 * analysed commit, where the fingerprints are computed. The cited lines are
 * proposed too when they are found unchanged, and once, in the symbol.
 *
 * The commit of the citation comes from `git blame` on the record: it is the
 * last commit that changed the line of the reference. When that line was
 * reworded after the citation, the file is read at that later commit, where
 * the cited line numbers may point elsewhere.
 */
export async function anchorProposals(
  repo: Repository,
  corpus: Corpus,
  index: SymbolIndex
): Promise<Map<string, AnchorProposal>> {
  const proposals = new Map<string, AnchorProposal>()
  for (const reference of corpus.references) {
    if (
      reference.kind !== 'path' ||
      reference.anchor !== null ||
      reference.lines === null
    ) {
      continue
    }
    const file = fileOf(repo, reference)
    const citedIn = corpus.citedIn.get(reference.id)
    if (file === null || citedIn === undefined) continue
    const symbols = await index.current(file)
    const then = await index.at(citedIn, file)
    if (symbols === null || then?.symbols == null) continue
    const cited = symbolAt(then.symbols, reference.lines.start)
    if (cited === undefined) continue
    const matches = symbols.filter(symbol => symbol.name === cited.name)
    if (matches.length !== 1) continue
    const symbol = matches[0]!

    const { start, end } = reference.lines
    const count = end - start + 1
    const snippet = then.source
      .split('\n')
      .slice(start - 1, end)
      .join('\n')
    const linesFingerprint = fingerprint(snippet)
    // The cited lines are proposed only when they occur once in the symbol:
    // a line such as `},` would otherwise match the wrong place.
    const starts =
      snippet.trim() === '' ? [] : matchLines(symbol, count, linesFingerprint)
    const linesStart = starts.length === 1 ? starts[0]! : null
    proposals.set(reference.id, {
      symbol: symbol.name,
      text: `${reference.path}#${symbol.name}`,
      fingerprint: fingerprint(symbol.text),
      symbolLines: { start: symbol.start, end: symbol.end },
      lines:
        linesStart === null
          ? null
          : { count, fingerprint: linesFingerprint, start: linesStart },
    })
  }
  return proposals
}
