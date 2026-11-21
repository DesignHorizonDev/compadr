// YAML read with its keys checked in linear time. The yaml library compares
// each key of a map with every key before it: a map of 80,000 keys takes a
// minute. The check here keeps the same rule, a key once per map, with a set.
import {
  isMap,
  isScalar,
  parseDocument,
  visit,
  YAMLParseError,
  type Document,
} from 'yaml'

/** A YAML document, with an error for each key that a map holds twice. */
export function parseYamlDocument(text: string): Document.Parsed {
  const document = parseDocument(text, { uniqueKeys: false })
  visit(document, {
    Map(_, map) {
      if (!isMap(map)) return
      const seen = new Set<unknown>()
      for (const pair of map.items) {
        // Scalar keys compare by value, other keys never, as in yaml 2.9.
        // NaN differs from itself there: it never repeats.
        if (!isScalar(pair.key) || Number.isNaN(pair.key.value)) continue
        if (seen.has(pair.key.value)) {
          const [start, end] = pair.key.range ?? [0, 0]
          document.errors.push(
            new YAMLParseError(
              [start, end],
              'DUPLICATE_KEY',
              'Map keys must be unique'
            )
          )
        }
        seen.add(pair.key.value)
      }
    },
  })
  // The first error of the text comes first, as the library gives them.
  document.errors.sort((a, b) => a.pos[0] - b.pos[0])
  return document
}

/** The value of a YAML text. Throws its first error, as `parse` of yaml does. */
export function parseYaml(text: string): unknown {
  const document = parseYamlDocument(text)
  if (document.errors.length > 0) throw document.errors[0]!
  return document.toJS()
}
