import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

// The Midnight runtime ships WASM (onchain-runtime-v3) that uses top-level
// await; the wasm plugin plus build.target 'esnext' (native TLA) handle it —
// adapted from the official example-bboard configuration.
export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Separate chunk for WASM modules to avoid top-level await issues.
          if (id.includes('onchain-runtime-v3')) return 'wasm';
        },
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      extensions: ['.js', '.cjs'],
      ignoreDynamicRequires: true,
    },
  },
  plugins: [react(), wasm()],
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
      supported: { 'top-level-await': true },
      platform: 'browser',
    },
    include: ['@midnight-ntwrk/compact-runtime'],
    exclude: ['@midnight-ntwrk/onchain-runtime-v3'],
  },
  resolve: {
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
    mainFields: ['browser', 'module', 'main'],
    alias: {
      // Named-export and Node-builtin shims for browser bundling.
      'isomorphic-ws': fileURLToPath(new URL('./src/shims/isomorphic-ws.ts', import.meta.url)),
      assert: fileURLToPath(new URL('./src/shims/assert.ts', import.meta.url)),
    },
  },
  server: {
    // The app imports the compiled contract module and shared evidence code
    // from the repository root (one level above this Vite root).
    fs: { allow: ['..'] },
  },
});
