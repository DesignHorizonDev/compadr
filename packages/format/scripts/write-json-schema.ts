// Writes the JSON Schemas of the drift report and of the assist contract
// into schema/. A test fails when a committed file differs from its zod
// schema: run `yarn workspace @compadr/format schema` after changing
// src/report-schema.ts, src/assist.ts or src/semantic-findings.ts.
import { writeFileSync } from 'node:fs'
import {
  assistRequestJsonSchema,
  assistSuggestionJsonSchema,
} from '../src/assist.ts'
import { driftReportJsonSchema } from '../src/report-schema.ts'
import { semanticFindingsJsonSchema } from '../src/semantic-findings.ts'

const schemas: [string, Record<string, unknown>][] = [
  ['drift-report.schema.json', driftReportJsonSchema()],
  ['assist-request.schema.json', assistRequestJsonSchema()],
  ['assist-suggestion.schema.json', assistSuggestionJsonSchema()],
  ['semantic-findings.schema.json', semanticFindingsJsonSchema()],
]
for (const [name, schema] of schemas) {
  const target = new URL(`../schema/${name}`, import.meta.url)
  writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`)
  console.log(`✔ ${target.pathname}`)
}
