import { describe, it, expect, beforeEach } from 'vitest';
import { localStoragePrivateStateProvider } from './local-private-state-provider';

/** Minimal Storage shim so the provider runs under Node. */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  return store;
}

const CONTRACT_A = 'a'.repeat(64);
const CONTRACT_B = 'b'.repeat(64);

let store: Map<string, string>;
beforeEach(() => {
  store = installLocalStorage();
});

describe('localStorage private-state provider', () => {
  it('requires a contract address before use', async () => {
    const p = localStoragePrivateStateProvider<string, { x: number }>();
    await expect(p.get('id')).rejects.toThrow(/setContractAddress/);
  });

  it('persists and reads back state, surviving a new provider instance (reload)', async () => {
    const p1 = localStoragePrivateStateProvider<string, { records: Record<string, string> }>();
    p1.setContractAddress(CONTRACT_A);
    await p1.set('state', { records: { '1001': 'digest' } });

    const p2 = localStoragePrivateStateProvider<string, { records: Record<string, string> }>();
    p2.setContractAddress(CONTRACT_A);
    expect(await p2.get('state')).toEqual({ records: { '1001': 'digest' } });
  });

  it('scopes state per contract address', async () => {
    const p = localStoragePrivateStateProvider<string, string>();
    p.setContractAddress(CONTRACT_A);
    await p.set('k', 'for-A');
    p.setContractAddress(CONTRACT_B);
    expect(await p.get('k')).toBeNull();
    await p.set('k', 'for-B');
    p.setContractAddress(CONTRACT_A);
    expect(await p.get('k')).toBe('for-A');
  });

  it('remove and clear only touch the current contract', async () => {
    const p = localStoragePrivateStateProvider<string, string>();
    p.setContractAddress(CONTRACT_A);
    await p.set('k1', 'v1');
    await p.set('k2', 'v2');
    p.setContractAddress(CONTRACT_B);
    await p.set('k1', 'other');
    p.setContractAddress(CONTRACT_A);
    await p.remove('k1');
    expect(await p.get('k1')).toBeNull();
    expect(await p.get('k2')).toBe('v2');
    await p.clear();
    expect(await p.get('k2')).toBeNull();
    p.setContractAddress(CONTRACT_B);
    expect(await p.get('k1')).toBe('other');
  });

  it('never writes outside its own key prefixes', async () => {
    const p = localStoragePrivateStateProvider<string, string>();
    p.setContractAddress(CONTRACT_A);
    await p.set('k', 'v');
    await p.setSigningKey(CONTRACT_A, 'sk' as any);
    for (const key of store.keys()) expect(key.startsWith('evidence-gateway/')).toBe(true);
  });

  it('export/import round-trips with conflict strategies', async () => {
    const p = localStoragePrivateStateProvider<string, string>();
    p.setContractAddress(CONTRACT_A);
    await p.set('k', 'v');
    const exported = await p.exportPrivateStates();
    expect(exported.format).toBe('midnight-private-state-export');

    await expect(p.importPrivateStates(exported)).rejects.toThrow(/conflict/);
    expect(await p.importPrivateStates(exported, { conflictStrategy: 'skip' })).toEqual({ imported: 0, skipped: 1, overwritten: 0 });
    await p.remove('k');
    expect(await p.importPrivateStates(exported)).toEqual({ imported: 1, skipped: 0, overwritten: 0 });
    expect(await p.get('k')).toBe('v');
  });
});
