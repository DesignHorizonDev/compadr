import {
  FEATURE_ID,
  locateQuote,
  type Decision,
  type Feature,
  type FeatureGlossary,
  type ReplacedRule,
} from '@compadr/format'
import type { Corpus } from './read-corpus.ts'
import { changedBy } from './relations.ts'

/** A feature identifier made from a file slug: `0008-Activités.md` → `activites`. */
export function featureId(slug: string): string {
  const id = slug
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return FEATURE_ID.test(id) ? id : 'feature'
}

function slugOf(decision: Decision): string {
  const name = decision.file.slice(decision.file.lastIndexOf('/') + 1)
  return name.replace(/\.md$/i, '').replace(/^\d{1,4}[-_]?/, '')
}

/** The features that the records and the glossary declare. */
function declaredFeatures(
  decisions: readonly Decision[],
  glossary: FeatureGlossary
): Feature[] {
  const known = new Set(decisions.map(decision => decision.number))
  const members = new Map<string, number[]>()
  for (const decision of decisions) {
    if (decision.feature === null) continue
    members.set(decision.feature, [
      ...(members.get(decision.feature) ?? []),
      decision.number,
    ])
  }
  const entries = new Map(glossary.features.map(entry => [entry.id, entry]))
  const ids = [
    ...entries.keys(),
    ...[...members.keys()].filter(id => !entries.has(id)).sort(),
  ]
  return ids
    .filter(id => FEATURE_ID.test(id))
    .map(id => {
      const entry = entries.get(id)
      const list = members.get(id) ?? []
      // Without a glossary entry, the main decision is the only member that
      // names no parent.
      const roots = list.filter(
        n => decisions.find(d => d.number === n)!.parent === null
      )
      const main = entry?.main ?? (roots.length === 1 ? roots[0]! : null)
      const all = new Set(list)
      if (main !== null && known.has(main)) all.add(main)
      return {
        id,
        label: entry?.label ?? id,
        main,
        source: 'declared' as const,
        decisions: [...all].sort((a, b) => a - b),
        ...(entry?.rules === undefined ? {} : { rules: entry.rules }),
      }
    })
}

/** A cited file shared by more decisions than this share says little. */
const FREQUENT_FILE_SHARE = 0.1
/** Two decisions whose cited files overlap less than this are not linked. */
const MIN_OVERLAP = 0.1
/** Weight of a relation between two decisions, next to a file overlap. */
const RELATION_WEIGHT = 1

/**
 * The code files of each decision that the grouping reads: the files that its
 * record cites, outside the ADR folder, and the code files that cite it.
 */
export function citedFiles(
  corpus: Pick<Corpus, 'adrDir' | 'references' | 'citations'>,
  isFile: (path: string) => boolean
): Map<number, Set<string>> {
  const files = new Map<number, Set<string>>()
  const add = (decision: number, file: string) => {
    const set = files.get(decision) ?? new Set<string>()
    set.add(file)
    files.set(decision, set)
  }
  for (const reference of corpus.references) {
    if (reference.kind !== 'path') continue
    for (const path of reference.resolvedPaths) {
      if (!path.startsWith(`${corpus.adrDir}/`) && isFile(path)) {
        add(reference.decision, path)
      }
    }
  }
  for (const citation of corpus.citations) {
    if (citation.inCode) add(citation.decision, citation.file)
  }
  return files
}

/**
 * The links between decisions: each relation weighs RELATION_WEIGHT, and two
 * decisions weigh the overlap of their cited files (Jaccard index), from
 * MIN_OVERLAP. A file that more than FREQUENT_FILE_SHARE of the decisions
 * cite is left out.
 */
function links(
  decisions: readonly Decision[],
  files: ReadonlyMap<number, ReadonlySet<string>>
): Map<number, Map<number, number>> {
  const numbers = decisions.map(d => d.number)
  const weights = new Map<number, Map<number, number>>(
    numbers.map(n => [n, new Map()])
  )
  const add = (a: number, b: number, weight: number) => {
    if (a === b || !weights.has(a) || !weights.has(b)) return
    weights.get(a)!.set(b, (weights.get(a)!.get(b) ?? 0) + weight)
    weights.get(b)!.set(a, (weights.get(b)!.get(a) ?? 0) + weight)
  }
  for (const [target, list] of changedBy(decisions)) {
    for (const n of list) add(n, target, RELATION_WEIGHT)
  }
  const count = new Map<string, number>()
  for (const n of numbers) {
    for (const file of files.get(n) ?? []) {
      count.set(file, (count.get(file) ?? 0) + 1)
    }
  }
  const cap = Math.max(2, Math.floor(numbers.length * FREQUENT_FILE_SHARE))
  const kept = new Map(
    numbers.map(n => [
      n,
      new Set([...(files.get(n) ?? [])].filter(f => count.get(f)! <= cap)),
    ])
  )
  for (let i = 0; i < numbers.length; i++) {
    const a = kept.get(numbers[i]!)!
    if (a.size === 0) continue
    for (let j = i + 1; j < numbers.length; j++) {
      const b = kept.get(numbers[j]!)!
      if (b.size === 0) continue
      let shared = 0
      for (const file of a) if (b.has(file)) shared++
      const overlap = shared / (a.size + b.size - shared)
      if (shared > 0 && overlap >= MIN_OVERLAP) {
        add(numbers[i]!, numbers[j]!, overlap)
      }
    }
  }
  return weights
}

/**
 * One local moving step of the Louvain method: each node, in order, joins
 * the group of its neighbours that gains the most modularity, until no node
 * moves. `inner` is the weight inside each node. Returns the group of each
 * node.
 */
function moveNodes(
  nodes: readonly number[],
  weights: ReadonlyMap<number, ReadonlyMap<number, number>>,
  inner: ReadonlyMap<number, number>
): Map<number, number> {
  const degree = new Map(
    nodes.map(n => [
      n,
      [...weights.get(n)!.values()].reduce((a, b) => a + b, 0) +
        (inner.get(n) ?? 0),
    ])
  )
  const total = [...degree.values()].reduce((a, b) => a + b, 0)
  const group = new Map(nodes.map(n => [n, n]))
  if (total === 0) return group
  const sum = new Map(nodes.map(n => [n, degree.get(n)!]))
  for (let pass = 0; pass < 100; pass++) {
    let moved = false
    for (const n of nodes) {
      const k = degree.get(n)!
      if (k === 0) continue
      const own = group.get(n)!
      sum.set(own, sum.get(own)! - k)
      const toward = new Map<number, number>()
      for (const [other, weight] of weights.get(n)!) {
        const g = group.get(other)!
        toward.set(g, (toward.get(g) ?? 0) + weight)
      }
      let best = own
      let gain = (toward.get(own) ?? 0) - (sum.get(own)! * k) / total
      for (const [g, weight] of toward) {
        const candidate = weight - (sum.get(g)! * k) / total
        if (candidate > gain + 1e-9) {
          gain = candidate
          best = g
        }
      }
      group.set(n, best)
      sum.set(best, sum.get(best)! + k)
      if (best !== own) moved = true
    }
    if (!moved) break
  }
  return group
}

/**
 * Groups of linked decisions, by the Louvain method: a local moving step,
 * then the groups become the nodes of a smaller graph, until no group joins
 * another.
 */
function communities(
  numbers: readonly number[],
  weights: ReadonlyMap<number, ReadonlyMap<number, number>>
): number[][] {
  // The decisions of each node of the current graph.
  let members = new Map(numbers.map(n => [n, [n]]))
  let graph = weights
  let inner = new Map<number, number>()
  for (;;) {
    const nodes = [...members.keys()].sort((a, b) => a - b)
    const group = moveNodes(nodes, graph, inner)
    if (new Set(group.values()).size === nodes.length) break
    const next = new Map<number, number[]>()
    const nextGraph = new Map<number, Map<number, number>>()
    const nextInner = new Map<number, number>()
    for (const n of nodes) {
      const g = group.get(n)!
      next.set(g, [...(next.get(g) ?? []), ...members.get(n)!])
      nextGraph.set(g, nextGraph.get(g) ?? new Map<number, number>())
      nextInner.set(g, (nextInner.get(g) ?? 0) + (inner.get(n) ?? 0))
    }
    for (const n of nodes) {
      const g = group.get(n)!
      for (const [other, weight] of graph.get(n)!) {
        const h = group.get(other)!
        if (g === h) nextInner.set(g, nextInner.get(g)! + weight)
        else nextGraph.get(g)!.set(h, (nextGraph.get(g)!.get(h) ?? 0) + weight)
      }
    }
    members = next
    graph = nextGraph
    inner = nextInner
  }
  return [...members.values()]
    .map(list => [...list].sort((a, b) => a - b))
    .filter(list => list.length >= 2)
}

/**
 * A first grouping for a repository that declares none. Two decisions are
 * linked by their relations and by the code files that both cite (see
 * `links`), and the linked decisions form groups (see `communities`). The
 * main decision of a group is the one that the most newer decisions of the
 * group change, then the most linked one, then the oldest one. A decision
 * linked to no other stays out of the features.
 */
export function proposeFeatures(
  decisions: readonly Decision[],
  files: ReadonlyMap<number, ReadonlySet<string>> = new Map()
): Feature[] {
  const byNumber = new Map(decisions.map(d => [d.number, d]))
  const numbers = [...byNumber.keys()].sort((a, b) => a - b)
  const weights = links(
    numbers.map(n => byNumber.get(n)!),
    files
  )
  const newer = changedBy(decisions)
  const groups = communities(numbers, weights).map(list => {
    const inGroup = new Set(list)
    const rank = (n: number) => [
      (newer.get(n) ?? []).filter(m => inGroup.has(m)).length,
      [...weights.get(n)!]
        .filter(([m]) => inGroup.has(m))
        .reduce((a, [, w]) => a + w, 0),
    ]
    const main = [...list].sort((a, b) => {
      const [ra, wa] = rank(a)
      const [rb, wb] = rank(b)
      return rb! - ra! || wb! - wa! || a - b
    })[0]!
    return { main, decisions: list }
  })
  groups.sort((a, b) => a.main - b.main)

  const used = new Set<string>()
  return groups.map(({ main, decisions: list }) => {
    const decision = byNumber.get(main)!
    let id = featureId(slugOf(decision))
    if (used.has(id)) id = `${id}-${String(main).padStart(4, '0')}`
    used.add(id)
    return {
      id,
      label: decision.title,
      main,
      source: 'proposed' as const,
      decisions: list,
    }
  })
}

/**
 * The features of the repository: those it declares, or a proposed grouping
 * when no record and no glossary declares one.
 */
export function computeFeatures(
  corpus: Corpus,
  isFile: (path: string) => boolean = () => true
): Feature[] {
  const declares =
    corpus.glossary.features.length > 0 ||
    corpus.decisions.some(decision => decision.feature !== null)
  return declares
    ? declaredFeatures(corpus.decisions, corpus.glossary)
    : proposeFeatures(corpus.decisions, citedFiles(corpus, isFile))
}

/**
 * What keeps a declaration out of the features: the problems of the glossary,
 * a record whose compadr.feature is not an identifier, and a main decision
 * that the folder does not hold.
 */
export function featureProblems(corpus: Corpus): string[] {
  const known = new Set(corpus.decisions.map(decision => decision.number))
  const pad = (n: number) => String(n).padStart(4, '0')
  return [
    ...corpus.glossary.problems,
    ...corpus.glossary.features
      .filter(entry => entry.main !== null && !known.has(entry.main))
      .map(
        entry =>
          `${entry.id}: main decision ${pad(entry.main!)} is not in the folder`
      ),
    ...corpus.decisions
      .filter(d => d.feature !== null && !FEATURE_ID.test(d.feature))
      .map(
        d =>
          `ADR ${pad(d.number)}: compadr.feature "${d.feature}" is not a feature identifier (lowercase-words)`
      ),
  ]
}

/**
 * Where each rule quoted as replaced comes from. The engine looks in the
 * decisions named before the quote, or else in the older decisions that the
 * record changes. A rule found once in the Decision section of a record gets
 * its location; a rule found once elsewhere in the record gets its target
 * only.
 */
export function findReplacedRules(corpus: Corpus): ReplacedRule[] {
  const byNumber = new Map(corpus.decisions.map(d => [d.number, d]))
  const changes = new Map<number, number[]>()
  for (const [target, list] of changedBy(corpus.decisions)) {
    for (const n of list) changes.set(n, [...(changes.get(n) ?? []), target])
  }
  const rules: ReplacedRule[] = []
  for (const [number, quoted] of [...corpus.quotedRules].sort(
    ([a], [b]) => a - b
  )) {
    for (const { quote, decisions } of quoted) {
      const candidates = (
        decisions.length > 0 ? decisions : (changes.get(number) ?? [])
      ).filter(n => n !== number && byNumber.has(n))
      let found: ReplacedRule | null = null
      for (const target of candidates) {
        const sections = byNumber.get(target)!.text?.sections ?? []
        const hits = sections.flatMap((section, index) => {
          const at = locateQuote(section.markdown, quote)
          return at === null ? [] : [{ section: index, ...at }]
        })
        if (hits.length === 1) {
          found = { decision: number, quote, target, location: hits[0]! }
          break
        }
        if (
          hits.length === 0 &&
          locateQuote(corpus.records.get(target) ?? '', quote) !== null
        ) {
          found = { decision: number, quote, target, location: null }
          break
        }
      }
      rules.push(
        found ?? { decision: number, quote, target: null, location: null }
      )
    }
  }
  return rules
}
