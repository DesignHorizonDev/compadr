#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { runConsole } from './main.ts'

const result = await runConsole(
  process.argv.slice(2),
  {
    out: line => console.log(line),
    err: line => console.error(line),
  },
  // The build puts this file in dist/server, the pages in dist/pages and the
  // .wasm files in dist/server/wasm (tsup.config.ts).
  {
    pages: fileURLToPath(new URL('../pages/', import.meta.url)),
    locateWasm: file =>
      fileURLToPath(new URL(`./wasm/${file}`, import.meta.url)),
  }
)
if (typeof result === 'number') process.exitCode = result
