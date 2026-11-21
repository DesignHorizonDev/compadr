// Checked references. A drift signal of a cited line or file starts from the
// date the line of the record was written. When a person checks that the
// reference still holds, the record keeps the date of the commit they
// checked, and the signals start from that date instead:
//
//   compadr:
//     checked:
//       "services/billing.ts:120": 2026-11-04T09:12:00Z
//       "services/billing.ts:140":
//         at: 2026-11-04T09:12:00Z
//         by: Ana Martin
//
// The key is the reference as the record cites it, between backticks. A
// later change of the code raises the signal again.
import { isMap, isScalar } from 'yaml'
import { parseYamlDocument } from './yaml.ts'
import { editFrontmatter, ensureMap } from './frontmatter-edit.ts'

export interface CheckedReference {
  /** The reference as the record cites it, between backticks. */
  text: string
  /** UTC date and time of the commit that was checked. */
  at: string
  /** The person who checked. Without it, the entry holds the date alone. */
  by?: string
}

/** `markdown` with each reference recorded as checked at its date. */
export function writeChecked(
  markdown: string,
  checked: readonly CheckedReference[]
): string {
  if (checked.length === 0) return markdown
  return editFrontmatter(markdown, document => {
    ensureMap(document, ['compadr', 'checked'])
    for (const { text, at, by } of checked) {
      document.setIn(
        ['compadr', 'checked', text],
        by === undefined ? at : document.createNode({ at, by })
      )
    }
  })
}

const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/

/**
 * Line of the record (1-based) where each entry of `compadr.checked` starts,
 * by reference. git blame on that line tells who wrote the entry.
 */
export function checkedLines(markdown: string): Map<string, number> {
  const lines = new Map<string, number>()
  const source = FRONTMATTER.exec(markdown)?.[1]
  if (source === undefined) return lines
  const document = parseYamlDocument(source)
  const entries = document.getIn(['compadr', 'checked'], true)
  if (!isMap(entries)) return lines
  for (const pair of entries.items) {
    if (!isScalar(pair.key) || pair.key.range == null) continue
    const offset = pair.key.range[0]
    // The frontmatter starts on line 2, after the first `---`.
    const line = source.slice(0, offset).split('\n').length + 1
    lines.set(String(pair.key.value), line)
  }
  return lines
}
