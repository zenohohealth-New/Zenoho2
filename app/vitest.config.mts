import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Root is the repo root so tests/ (a top-level folder per README) can import
// app/src directly, while vitest itself resolves from app/node_modules.
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  // Root is the repo root, so vitest would otherwise put its cache in a
  // repo-root node_modules/.vite. Keep it inside app/ where the real
  // node_modules lives, so the root stays clean.
  cacheDir: fileURLToPath(new URL('node_modules/.vite', import.meta.url)),
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
