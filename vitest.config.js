import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Vitest-only config: no Svelte plugin so tests run without full Vite/Svelte server.
// Use this for JS/TS unit tests. For component tests you’d use the full vite.config.
export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, 'src/lib'),
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.{js,ts}'],
    environment: 'node',
    globals: true,
  },
})
