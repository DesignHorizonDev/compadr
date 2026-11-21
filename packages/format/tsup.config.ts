import { defineConfig } from 'tsup'

// The published library: one ES module and its type declarations. zod and
// yaml stay dependencies of the package, so the bundle does not hold them.
// The workspace packages import src/ directly and do not need this build.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: false,
  dts: true,
})
