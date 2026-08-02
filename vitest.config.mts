import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'components/**/*.test.ts', 'app/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: [
        'lib/**/*.test.ts',
        // Runnable harness, exercised by `npm run evaluate` in CI.
        'lib/detection/evaluate.ts',
        // Canvas drawing needs a real browser; the pure logic it depends on
        // (labels, projection) is unit-tested, and the rest is covered by the
        // Playwright suite against a production build.
        'lib/renderer/globe-renderer.ts',
        // React hooks are covered end to end rather than through a DOM shim.
        'lib/hooks/**',
        // Type-only modules contribute no executable statements.
        'lib/orbital/types.ts',
        'lib/simulation/types.ts',
      ],
      // A floor, not a target. Set just below current levels so a genuine
      // regression fails CI without the build breaking on noise.
      thresholds: {
        statements: 85,
        branches: 82,
        functions: 85,
        lines: 88,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
