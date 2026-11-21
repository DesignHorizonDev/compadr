import { mkdirSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { reportsApi } from './dev/reports-api.ts'

/**
 * Writes the source files of the pages in dist/client-modules.json, outside
 * the pages, so that tools/pack.mjs can list the third-party packages that
 * the build bundles.
 */
function bundledModules(): Plugin {
  return {
    name: 'compadr-bundled-modules',
    apply: 'build',
    generateBundle() {
      const modules = [...this.getModuleIds()]
        .filter(id => !id.startsWith('\0'))
        .map(id => relative(process.cwd(), id))
      mkdirSync('dist', { recursive: true })
      writeFileSync(
        'dist/client-modules.json',
        `${JSON.stringify(modules.sort(), null, 2)}\n`
      )
    },
  }
}

export default defineConfig({
  // COMPADR_REPORTS_DIR names the folder of drift reports that the
  // development and preview servers serve on /api/reports.
  plugins: [
    react(),
    reportsApi(process.env.COMPADR_REPORTS_DIR),
    bundledModules(),
  ],
  build: {
    // The pages only: the program of the console lives in dist/server, and
    // the server never serves it.
    outDir: 'dist/pages',
  },
  test: {
    environment: 'jsdom',
  },
})
