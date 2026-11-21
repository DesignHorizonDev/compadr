// "ADR-0012", "ADR 12", "adr0012", "ADRs 3" in the text of a decision record.
const ADR_REFERENCE = /\bADRs?[- ]?(0*(\d{1,4}))\b/gi
// The rest of a list after one prefix: "les ADR 0002, 0010 et 0012", "ADRs 3
// and 4". A number of the list has the width of the first one ("0010" after
// "0002", "4" after "3"): "l'ADR 0010 et 3 autres" names one decision. A date
// or a decimal number ("0010, 2026-10-21") is not a decision.
const LIST_NEXT =
  /[ \t]*(?:,|&|\bet\b|\band\b|\bou\b|\bor\b)[ \t]*(?:ADRs?[- ]?)?(0*(\d{1,4}))\b(?![-./:]\d)/iy

/** The decisions cited in a text, with the end of each citation. */
export function findAdrReferences(
  text: string
): { number: number; end: number }[] {
  const found: { number: number; end: number }[] = []
  ADR_REFERENCE.lastIndex = 0
  for (
    let match = ADR_REFERENCE.exec(text);
    match !== null;
    match = ADR_REFERENCE.exec(text)
  ) {
    found.push({
      number: Number(match[2]),
      end: match.index + match[0].length,
    })
    const width = match[1]!.length
    LIST_NEXT.lastIndex = ADR_REFERENCE.lastIndex
    for (
      let next = LIST_NEXT.exec(text);
      next !== null && next[1]!.length === width;
      next = LIST_NEXT.exec(text)
    ) {
      found.push({ number: Number(next[2]), end: LIST_NEXT.lastIndex })
      ADR_REFERENCE.lastIndex = LIST_NEXT.lastIndex
    }
  }
  return found
}

/** Numbers of the decisions cited in a text, in order of appearance. */
export function findAdrNumbers(text: string): number[] {
  return findAdrReferences(text).map(reference => reference.number)
}
