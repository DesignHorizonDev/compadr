// Anchored references. A decision record cites code with a path and a line
// number (`file.ts:120`), which breaks as soon as the file moves. An anchored
// reference names a symbol instead (`file.ts#Class.method`), and the record
// keeps a fingerprint of that symbol in its frontmatter:
//
//   compadr:
//     anchors:
//       "services/billing.ts#chargeCard":
//         fingerprint: sha256:3f2a9c0b7d1e4a65
//         lines: { count: 3, fingerprint: sha256:9b1c22f0e8a4d317 }
//
// A fingerprint is `sha256:` followed by the first 16 hexadecimal digits of
// the SHA-256 of the text, once each run of white space is replaced by one
// space and the ends are trimmed. `lines` is optional: it tracks the cited
// lines inside a large symbol. `count` is the number of consecutive lines of
// the tracked span, and `fingerprint` is the fingerprint of those lines joined
// by line breaks. The span has no fixed start: the engine looks for `count`
// consecutive lines of the symbol with that fingerprint.
//
// A symbol is an ASCII identifier, or several joined by dots. Private class
// members (`#field`) and non-ASCII names cannot be anchored.

export interface AnchoredPath {
  path: string
  /** Qualified name: `chargeCard`, `BillingService.charge`. */
  symbol: string
}

export interface RecordedLines {
  count: number
  fingerprint: string
}

/** An anchor as the record declares it in `compadr.anchors`. */
export interface RecordedAnchor {
  fingerprint: string
  lines: RecordedLines | null
}

const IDENTIFIER = '[A-Za-z_$][\\w$]*'
const ANCHORED_PATH = new RegExp(
  `^([^#\\s]+)#(${IDENTIFIER}(?:\\.${IDENTIFIER})*)$`
)
export const FINGERPRINT = /^sha256:[0-9a-f]{16}$/

/** Reads `path#Symbol`. Returns null for any other text. */
export function parseAnchoredPath(text: string): AnchoredPath | null {
  const match = ANCHORED_PATH.exec(text)
  return match ? { path: match[1]!, symbol: match[2]! } : null
}

export function formatAnchoredPath({ path, symbol }: AnchoredPath): string {
  return `${path}#${symbol}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readLines(value: unknown): RecordedLines | null {
  const lines = asRecord(value)
  if (
    lines === null ||
    typeof lines.count !== 'number' ||
    !Number.isInteger(lines.count) ||
    lines.count < 1 ||
    typeof lines.fingerprint !== 'string' ||
    !FINGERPRINT.test(lines.fingerprint)
  ) {
    return null
  }
  return { count: lines.count, fingerprint: lines.fingerprint }
}

/**
 * Reads `compadr.anchors`. Entries whose key is not `path#Symbol` or whose
 * fingerprint is malformed are left out: the reference then counts as
 * anchored without a fingerprint.
 */
export function readAnchors(value: unknown): Record<string, RecordedAnchor> {
  const anchors: Record<string, RecordedAnchor> = {}
  for (const [key, entry] of Object.entries(asRecord(value) ?? {})) {
    const anchor = asRecord(entry)
    if (
      parseAnchoredPath(key) === null ||
      typeof anchor?.fingerprint !== 'string' ||
      !FINGERPRINT.test(anchor.fingerprint)
    ) {
      continue
    }
    anchors[key] = {
      fingerprint: anchor.fingerprint,
      lines: readLines(anchor.lines),
    }
  }
  return anchors
}
