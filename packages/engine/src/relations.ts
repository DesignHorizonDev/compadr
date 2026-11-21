import type { Decision, Family } from '@compadr/format'

/**
 * Newer decisions that change each decision: its amendments, its
 * replacements, and the links declared on either side. A relation only goes
 * from a newer decision to an older one.
 */
export function changedBy(
  decisions: readonly Decision[]
): Map<number, number[]> {
  const sets = new Map<number, Set<number>>()
  const add = (target: number, numbers: Iterable<number>) => {
    const set = sets.get(target) ?? new Set<number>()
    for (const n of numbers) if (n > target) set.add(n)
    sets.set(target, set)
  }
  for (const decision of decisions) {
    for (const target of decision.amends) add(target, [decision.number])
    add(decision.number, [...decision.supersededBy, ...decision.amendedBy])
  }
  return new Map(
    [...sets]
      .filter(([, set]) => set.size > 0)
      .map(([target, set]) => [target, [...set].sort((a, b) => a - b)])
  )
}

/**
 * Groups the decisions into families of a main decision and its details.
 * Each decision that changes older ones is attached to the oldest of them.
 * The grouping follows one level only: a transitive closure would merge the
 * whole corpus as soon as the records cite each other a lot.
 */
export function computeFamilies(decisions: readonly Decision[]): Family[] {
  const known = new Set(decisions.map(decision => decision.number))
  const parentOf = new Map<number, number>()
  for (const [target, newer] of changedBy(decisions)) {
    if (!known.has(target)) continue
    for (const detail of newer) {
      const current = parentOf.get(detail)
      if (current === undefined || target < current) {
        parentOf.set(detail, target)
      }
    }
  }
  const details = new Map<number, number[]>()
  for (const [detail, principal] of parentOf) {
    details.set(principal, [...(details.get(principal) ?? []), detail])
  }
  return [...details]
    .map(([principal, list]) => ({
      principal,
      details: list.sort((a, b) => a - b),
      principalIsDetail: parentOf.has(principal),
    }))
    .sort(
      (a, b) => b.details.length - a.details.length || a.principal - b.principal
    )
}
