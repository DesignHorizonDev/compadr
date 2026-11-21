#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { main } from './main.ts'
import { terminalText } from './terminal.ts'

process.exitCode = await main(
  process.argv.slice(2),
  {
    out: line => console.log(terminalText(line)),
    err: line => console.error(terminalText(line)),
  },
  // The build copies the .wasm files next to this file (tsup.config.ts).
  {
    locateWasm: file =>
      fileURLToPath(new URL(`./wasm/${file}`, import.meta.url)),
  }
)
