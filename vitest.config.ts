import { defineConfig } from 'vitest/config';

// Contract suites only. The frontend has its own vitest project (web/), with
// its own dependencies — without this scope the root run would also collect
// web/src/**/*.test.ts and fail wherever web deps are not installed (CI).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
