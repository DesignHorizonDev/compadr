# @compadr/format

The decision record format of [Compadr](https://compadr.io): the `compadr:` fields of a record, the ADR dialects that Compadr reads (adr-tools, MADR, Log4brains), and the JSON schemas of its reports.

```bash
npm install @compadr/format
```

```ts
import { readFileSync } from 'node:fs'
import { parseAdr } from '@compadr/format'

const path = 'docs/adr/0001-record-architecture-decisions.md'
const record = parseAdr(path, readFileSync(path, 'utf8'))
```

`parseAdr` returns the title, the status, the date, the relations and the `compadr:` fields of the record, or `null` when the file is not a record.

The status comes from the frontmatter, a `Status:` line of the header or a `## Status` section. When the section holds a dated list of states (`- 2024-09-09: Accepted`), the latest state gives the status. "Approved", "Merged" and "Decided" on its own count as accepted, and "Pending" counts as proposed. A sentence such as "Decided to wait" gives no status.

The JSON schemas are part of the package:

| Schema | Content |
|---|---|
| `@compadr/format/drift-report.schema.json` | Drift report of `compadr drift` |
| `@compadr/format/semantic-findings.schema.json` | Findings of the semantic check |
| `@compadr/format/assist-request.schema.json` | Request to the assist service |
| `@compadr/format/assist-suggestion.schema.json` | Suggestion of the assist service |

The [documentation](https://compadr.io/docs/) describes the fields and the reports. Questions and bugs go to the [issues](https://github.com/DesignHorizonDev/compadr/issues) or to contact@compadr.io.

## License

The format is under the Apache License 2.0 (`LICENSE`, `NOTICE`).
