export interface AdrFileName {
  /** Sequence number of the decision, as written in the file name. */
  number: number
  /** Rest of the file name, without the number and the extension. */
  slug: string
}

// adr-tools and MADR name each record `NNNN-title.md`.
const ADR_FILE_NAME = /^(\d{4})-(.+)\.md$/

/**
 * Reads the number and the slug of an ADR file name. Returns `null` when the
 * name does not follow the `NNNN-title.md` convention (an index or a
 * template, for example).
 */
export function parseAdrFileName(fileName: string): AdrFileName | null {
  const match = ADR_FILE_NAME.exec(fileName)
  if (!match) return null
  const [, digits, slug] = match
  return { number: Number(digits), slug: slug! }
}
