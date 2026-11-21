const STATUS_HEADER = /^(?:status|statut)$/i

function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())
}

/**
 * Reads the status of each decision in the tables of an ADR index (usually
 * `docs/adr/README.md`). The header row of a table names its status column
 * (`Status` or `Statut`), and the first cell of a row carries the number. A
 * table without a status column is skipped, as are the rows without a
 * four-digit number.
 */
export function parseAdrIndex(content: string): Map<number, string> {
  const statuses = new Map<number, string>()
  // Column of the status in the current table, or -1 before its header row.
  let statusColumn = -1
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.startsWith('|')) {
      statusColumn = -1
      continue
    }
    const cells = cellsOf(line)
    const header = cells.findIndex(cell =>
      STATUS_HEADER.test(cell.replace(/\*/g, '').trim())
    )
    if (header !== -1) {
      statusColumn = header
      continue
    }
    const match = /\b(\d{4})\b/.exec(cells[0] ?? '')
    const status = cells[statusColumn]
    if (statusColumn > 0 && match && status !== undefined) {
      statuses.set(Number(match[1]), status)
    }
  }
  return statuses
}
