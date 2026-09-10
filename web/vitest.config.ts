import { defineConfig } from 'vitest/config';

// App tests run in Node: they exercise the wallet-discovery filter, the
// localStorage-backed private-state provider and config resolution with small
// browser-global shims — no bundler, no WASM, no network.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
