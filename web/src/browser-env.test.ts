/**
 * Browser-environment guard.
 *
 * 1. Static: no file under web/src may reference Node globals or Node-only
 *    module forms. (The polyfill module is the single sanctioned exception.)
 * 2. Runtime: reproduces the production failure — a transitive dependency
 *    (@subsquid/util-internal-hex, used by the indexer provider) calls the
 *    bare global `Buffer.from`. With `Buffer` removed from globalThis it must
 *    throw exactly as it did in the browser; after loading src/polyfills.ts it
 *    must work. This test fails if the polyfill is ever dropped from main.tsx's
 *    import graph or stops installing the global.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.dirname(fileURLToPath(import.meta.url));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bBuffer\b/, 'Buffer global'],
  [/\bprocess\.(?!env\.NODE_ENV\b)/, 'process global (only process.env.NODE_ENV is replaced by Vite)'],
  [/\brequire\(/, 'CommonJS require'],
  [/__dirname|__filename/, '__dirname/__filename'],
  [/from ['"]node:/, 'node: import'],
  [/from ['"](fs|path|os|crypto|child_process|url)['"]/, 'Node built-in import'],
];

describe('browser environment: no Node globals in web/src', () => {
  const files = walk(srcDir).filter((f) => path.basename(f) !== 'polyfills.ts');

  it('scans a non-trivial set of source files', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  for (const file of files) {
    it(`${path.relative(srcDir, file)} is free of Node-only APIs`, () => {
      // Strip comments so prose mentioning these names does not count.
      const text = fs
        .readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const hits = FORBIDDEN.filter(([re]) => re.test(text)).map(([, label]) => label);
      expect(hits, `${path.relative(srcDir, file)} uses: ${hits.join(', ')}`).toEqual([]);
    });
  }

  it('main.tsx loads the polyfills before anything else', () => {
    const main = fs.readFileSync(path.join(srcDir, 'main.tsx'), 'utf-8');
    const firstImport = main.match(/^import .*$/m)?.[0] ?? '';
    expect(firstImport).toContain("./polyfills");
  });
});

describe('browser environment: wallet key parsing without a Buffer global', () => {
  const g = globalThis as unknown as { Buffer?: unknown; process?: unknown };
  const originalBuffer = g.Buffer;

  afterAll(() => {
    g.Buffer = originalBuffer;
  });

  it('reproduces the production failure on a real Bech32m coin key, then passes once polyfills are loaded', async () => {
    // Production path: buildProviders → getShieldedAddresses() returns Bech32m
    // keys → parseCoinPublicKeyToHex → @midnight-ntwrk/wallet-sdk-address-format
    // MidnightBech32m.parse, which calls the bare global Buffer.
    const { bech32m } = await import('@scure/base');
    const { parseCoinPublicKeyToHex } = await import('@midnight-ntwrk/midnight-js-utils');
    const keyBytes = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const bech32Key = bech32m.encode('mn_shield-cpk_preprod', bech32m.toWords(keyBytes), 1000);

    delete g.Buffer;
    expect(() => parseCoinPublicKeyToHex(bech32Key, 'preprod')).toThrow(/Buffer is not defined/);

    await import('./polyfills');
    expect(typeof g.Buffer).toBe('function');
    expect(parseCoinPublicKeyToHex(bech32Key, 'preprod')).toBe(
      '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
    );
  });

  it('hex-form keys never needed Buffer (why the fallback path worked)', async () => {
    const { parseCoinPublicKeyToHex } = await import('@midnight-ntwrk/midnight-js-utils');
    delete g.Buffer;
    expect(parseCoinPublicKeyToHex('11'.repeat(32), 'preprod')).toBe('11'.repeat(32));
  });
});
