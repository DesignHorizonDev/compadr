// Writes css/tokens.css. A test fails when the committed file differs from
// src/tokens.ts: run `yarn workspace @compadr/tokens css` after a change.
import { writeFileSync } from 'node:fs'
import { tokensCss } from '../src/tokens.ts'

const target = new URL('../css/tokens.css', import.meta.url)
writeFileSync(target, tokensCss())
console.log(`✔ ${target.pathname}`)
