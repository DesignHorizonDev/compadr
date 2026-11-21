/** "1 decision", "2 decisions". */
export function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 8)
}
