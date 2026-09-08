// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Build scripts are Node, not app code: never bundled, and they legitimately
    // use Node globals. Declaring the environment is configuration, not suppression.
    // Split by extension because .cjs is CommonJS and .mjs is ESM.
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'writable',
        require: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    // D-020: no in-memory store in production paths. The in-memory RHR history
    // loses everything on restart, so an L3 baseline could never accumulate
    // behind it. Enforced here rather than in a test so it costs no dependency.
    files: ['App.tsx', 'src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './src/storage/rhrStore',
              importNames: ['InMemoryRhrHistoryStore'],
              message:
                'D-020: InMemoryRhrHistoryStore is test-only. Use SqliteRhrHistoryStore.',
            },
            {
              name: './rhrStore',
              importNames: ['InMemoryRhrHistoryStore'],
              message:
                'D-020: InMemoryRhrHistoryStore is test-only. Use SqliteRhrHistoryStore.',
            },
            {
              name: '../storage/rhrStore',
              importNames: ['InMemoryRhrHistoryStore'],
              message:
                'D-020: InMemoryRhrHistoryStore is test-only. Use SqliteRhrHistoryStore.',
            },
          ],
        },
      ],
    },
  },
]);
