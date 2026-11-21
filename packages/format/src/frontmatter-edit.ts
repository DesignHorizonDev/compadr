// Edits the YAML frontmatter of a decision record and keeps the rest of the
// record, including the other keys of the frontmatter and their comments, as
// written.
import { isMap, isScalar, parseDocument, type Document } from 'yaml'

export class FrontmatterEditError extends Error {}

// The block between the two `---` lines may be empty.
const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/

/**
 * Makes each level of `path` a map: a missing or empty value becomes one.
 * Throws a FrontmatterEditError when a level holds another value.
 */
export function ensureMap(document: Document, path: readonly string[]): void {
  for (let depth = 1; depth <= path.length; depth++) {
    const level = path.slice(0, depth)
    const node = document.getIn(level, true)
    if (node === undefined || (isScalar(node) && node.value === null)) {
      document.setIn(level, document.createNode({}))
    } else if (!isMap(node)) {
      throw new FrontmatterEditError(`${level.join('.')} is not a map`)
    }
  }
}

/**
 * Applies `edit` to the frontmatter of `markdown`, and adds a frontmatter when
 * the record has none. Throws a FrontmatterEditError when the frontmatter is
 * not a YAML map.
 */
export function editFrontmatter(
  markdown: string,
  edit: (document: Document) => void
): string {
  const match = FRONTMATTER.exec(markdown)
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n'
  const document = parseDocument(match?.[1] ?? '')
  if (document.errors.length > 0) {
    throw new FrontmatterEditError(
      `the frontmatter is not valid YAML: ${document.errors[0]!.message}`
    )
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new FrontmatterEditError('the frontmatter is not a map')
  }
  edit(document)
  // No line folding and no padding in flow collections: the other keys keep
  // the layout of the record.
  const yaml = document
    .toString({ lineWidth: 0, flowCollectionPadding: false })
    .replace(/\n$/, '')
    .split('\n')
    .join(newline)
  const frontmatter = `---${newline}${yaml}${newline}---${newline}`
  return match
    ? frontmatter + markdown.slice(match[0].length)
    : frontmatter + newline + markdown
}
