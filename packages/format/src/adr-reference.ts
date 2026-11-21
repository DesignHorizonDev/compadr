// "ADR-0012", "ADR 12", "adr0012", "ADRs 3" in the text of a decision record.
const ADR_REFERENCE = /\bADRs?[- ]?(0*(\d{1,4}))\b/gi
// The rest of a list after one prefix: "les ADR 0002, 0010 et 0012", "ADRs 3,
// 4, and 5". A number of the list has the width of the first one ("0010"
// after "0002"), or, in a list without leading zeros, a greater value with
// the width of the previous one or one digit more ("10" after "9"). So "l'ADR 0010 et 3 autres" names one
// decision. A date or a decimal number ("0010, 2026-10-21") is not a decision.
// A count of the same width still reads as one: "ADR 12, 14 users" gives 12
// and 14.
const LIST_NEXT =
  /[ \t]*(?:,(?:[ \t]*(?:&|\bet\b|\band\b|\bou\b|\bor\b))?|&|\bet\b|\band\b|\bou\b|\bor\b)[ \t]*(?:ADRs?[- ]?)?(0*(\d{1,4}))\b(?![-./:]\d)/iy

/** Whether `next` continues a list that starts with `first` after `previous`. */
function continuesList(first: string, previous: string, next: string): boolean {
  if (next.length === first.length) return true
  const padded = (written: string) =>
    written.length > 1 && written.startsWith('0')
  return (
    !padded(first) &&
    !padded(next) &&
    next.length >= previous.length &&
    next.length <= previous.length + 1 &&
    Number(next) > Number(previous)
  )
}

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
    const first = match[1]!
    let previous = first
    LIST_NEXT.lastIndex = ADR_REFERENCE.lastIndex
    for (
      let next = LIST_NEXT.exec(text);
      next !== null && continuesList(first, previous, next[1]!);
      next = LIST_NEXT.exec(text)
    ) {
      found.push({ number: Number(next[2]), end: LIST_NEXT.lastIndex })
      ADR_REFERENCE.lastIndex = LIST_NEXT.lastIndex
      previous = next[1]!
    }
  }
  return found
}

/** Numbers of the decisions cited in a text, in order of appearance. */
export function findAdrNumbers(text: string): number[] {
  return findAdrReferences(text).map(reference => reference.number)
}
