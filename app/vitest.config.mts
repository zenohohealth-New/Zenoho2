import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Root is the repo root so tests/ (a top-level folder per README) can import
// app/src directly, while vitest itself resolves from app/node_modules.
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
