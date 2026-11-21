// Rewrites a decision record to anchor some of its references: the text
// between backticks becomes `path#Symbol`, and `compadr.anchors` receives the
// fingerprint. The rest of the record, including the other keys of its
// frontmatter and their comments, is kept as written.
import {
  editFrontmatter,
  ensureMap,
  FrontmatterEditError,
} from './frontmatter-edit.ts'
import type { RecordedAnchor } from './anchor.ts'

export interface AnchorEdit {
  /** Line of the record (1-based) and column of the opening backtick. */
  adrLine: number
  column: number
  /** Current text between the backticks: `file.ts:120`. */
  from: string
  /** New text: `file.ts#Symbol`. */
  to: string
  anchor: RecordedAnchor
}

export class AnchorEditError extends Error {}

function anchorEntry(anchor: RecordedAnchor) {
  return anchor.lines === null
    ? { fingerprint: anchor.fingerprint }
    : {
        fingerprint: anchor.fingerprint,
        lines: {
          count: anchor.lines.count,
          fingerprint: anchor.lines.fingerprint,
        },
      }
}

function replaceReferences(markdown: string, edits: AnchorEdit[]): string {
  const lines = markdown.split('\n')
  // From the end of each line, so that an edit does not shift the columns of
  // the edits before it on the same line.
  const ordered = [...edits].sort(
    (a, b) => a.adrLine - b.adrLine || b.column - a.column
  )
  for (const edit of ordered) {
    const line = lines[edit.adrLine - 1]
    const start = edit.column - 1
    const cited = `\`${edit.from}\``
    if (
      line === undefined ||
      line.slice(start, start + cited.length) !== cited
    ) {
      throw new AnchorEditError(
        `line ${edit.adrLine}, column ${edit.column} does not cite ${cited}`
      )
    }
    lines[edit.adrLine - 1] =
      line.slice(0, start) + `\`${edit.to}\`` + line.slice(start + cited.length)
  }
  return lines.join('\n')
}

function addAnchors(markdown: string, edits: AnchorEdit[]): string {
  try {
    return editFrontmatter(markdown, document => {
      ensureMap(document, ['compadr', 'anchors'])
      for (const edit of edits) {
        document.setIn(
          ['compadr', 'anchors', edit.to],
          anchorEntry(edit.anchor)
        )
      }
    })
  } catch (error) {
    if (error instanceof FrontmatterEditError) {
      throw new AnchorEditError(error.message)
    }
    throw error
  }
}

/**
 * Anchors references of one record. Each edit must find its text at its line
 * and column, or nothing is changed and an AnchorEditError is thrown.
 */
export function applyAnchorEdits(
  markdown: string,
  edits: readonly AnchorEdit[]
): string {
  if (edits.length === 0) return markdown
  return addAnchors(replaceReferences(markdown, [...edits]), [...edits])
}
