import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { defineConfig } from 'tsup'

const require = createRequire(import.meta.url)

// The tree-sitter runtime and the grammars that the engine loads, copied
// into dist/server/wasm, where server/console.ts looks for them. The list
// follows packages/cli/tsup.config.ts.
const WASM = [
  'web-tree-sitter/web-tree-sitter.wasm',
  '@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm',
  '@vscode/tree-sitter-wasm/wasm/tree-sitter-tsx.wasm',
  '@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm',
]

// Runs after `vite build`, which writes the pages in dist/pages.
export default defineConfig({
  entry: { console: 'server/console.ts' },
  outDir: 'dist/server',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: false,
  // tools/pack.mjs reads the bundled files in dist/server/metafile-esm.json.
  metafile: true,
  // The server ships as one file, like the command line.
  noExternal: [/.*/],
  // yaml ships as CommonJS and requires Node modules (`process`). An ES
  // module bundle needs a real `require` for them.
  banner: {
    js: "import { createRequire as createRequireForBundle } from 'node:module'; const require = createRequireForBundle(import.meta.url);",
  },
  onSuccess: () => {
    mkdirSync('dist/server/wasm', { recursive: true })
    for (const file of WASM) {
      const source = require.resolve(file, {
        paths: [require.resolve('@compadr/engine')],
      })
      copyFileSync(source, `dist/server/wasm/${basename(source)}`)
    }
    return Promise.resolve()
  },
})
