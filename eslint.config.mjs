import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescriptConfig from 'eslint-config-next/typescript'

/**
 * eslint-config-next 16 ships native flat config, so the FlatCompat shim that
 * was needed for the v15 eslintrc format is gone — importing the flat exports
 * directly avoids the circular-reference crash that shim now produces.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // The pre-migration single-file build is kept for reference, not linted.
      'legacy/**',
      'next-env.d.ts',
    ],
  },

  ...coreWebVitals,
  ...typescriptConfig,

  {
    rules: {
      // Unused variables are an error, not a warning — they hide real mistakes.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    // Scripts and tests run in Node and legitimately write to stdout.
    files: ['scripts/**/*.mts', '**/*.test.ts', 'e2e/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
]

export default config
