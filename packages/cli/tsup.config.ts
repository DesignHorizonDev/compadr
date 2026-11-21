import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { defineConfig } from 'tsup'

const require = createRequire(import.meta.url)

// The tree-sitter runtime and the grammars that the engine loads. They are
// not JavaScript, so the bundle cannot hold them: the build copies them into
// dist/wasm, where src/cli.ts looks for them.
const WASM = [
  'web-tree-sitter/web-tree-sitter.wasm',
  '@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm',
  '@vscode/tree-sitter-wasm/wasm/tree-sitter-tsx.wasm',
  '@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm',
]

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: false,
  // tools/pack.mjs reads the bundled files in dist/metafile-esm.json.
  metafile: true,
  // The command line ships as one file: the workspace packages and their
  // dependencies (zod, yaml) are bundled into it.
  noExternal: [/.*/],
  // yaml ships as CommonJS and requires Node modules (`process`). An ES
  // module bundle needs a real `require` for them.
  banner: {
    // The alias keeps the name createRequire free for the bundled modules.
    js: "import { createRequire as createRequireForBundle } from 'node:module'; const require = createRequireForBundle(import.meta.url);",
  },
  onSuccess: () => {
    mkdirSync('dist/wasm', { recursive: true })
    for (const file of WASM) {
      const source = require.resolve(file, {
        paths: [require.resolve('@compadr/engine')],
      })
      copyFileSync(source, `dist/wasm/${basename(source)}`)
    }
    return Promise.resolve()
  },
})
