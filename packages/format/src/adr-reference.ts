// "ADR-0012", "ADR 12", "adr0012" in the text of a decision record.
const ADR_REFERENCE = /\bADR[- ]?0*(\d{1,4})\b/gi

/** The decisions cited in a text, with the end of each citation. */
export function findAdrReferences(
  text: string
): { number: number; end: number }[] {
  return [...text.matchAll(ADR_REFERENCE)].map(match => ({
    number: Number(match[1]),
    end: match.index + match[0].length,
  }))
}

/** Numbers of the decisions cited in a text, in order of appearance. */
export function findAdrNumbers(text: string): number[] {
  return [...text.matchAll(ADR_REFERENCE)].map(match => Number(match[1]))
}
