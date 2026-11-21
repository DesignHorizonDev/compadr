// Words of a header line that link a decision record to older ones. Internal
// to the package: the published API is what the records mean, not how the
// engine reads them.

/** Verbs of a header line that make this decision change an older one. */
export const AMENDS =
  /amends?|amende|remplace|compl[eè]te|pr[ée]cise|supersedes|modifie|r[ée]vise/i

/** Passive forms: a newer decision changes this one. */
export const AMENDED_BY =
  /(?:amended|superseded|replaced|refined|completed)\s+by|(?:amend[ée]e?|remplac[ée]e?|compl[ée]t[ée]e?|pr[ée]cis[ée]e?|modifi[ée]e?)s?\s+par/i

/** Verbs that replace a rule of an older decision. */
export const REPLACES = /\b(?:remplace|replaces?|supersedes)\b/i
