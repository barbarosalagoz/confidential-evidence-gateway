/**
 * The issuer secret key never reaches localStorage.
 *
 * Joins the registry against a mocked `findDeployedContract` (Lace and the
 * indexer are not available headless), pastes the issuer key, runs an issuer
 * circuit through the SDK-shaped `callTx` path — which, like the real SDK,
 * reads private state through the provider's `get` and writes the updated
 * state back through `set` — and then greps every localStorage entry under
 * the app's key prefix for the key. It must be absent, while the circuit
 * still saw it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@midnight-ntwrk/midnight-js-contracts', () => ({
  findDeployedContract: vi.fn(async (providers: any, opts: any) => {
    const psp = providers.privateStateProvider;
    // Real SDK behaviour on join: persist the initial private state if none exists.
    if ((await psp.get(opts.privateStateId)) === null) await psp.set(opts.privateStateId, opts.initialPrivateState);
    const seen: any[] = [];
    const call = async () => {
      // Real SDK behaviour on a call: read the private state for the
      // witnesses, then write the (possibly updated) state back.
      const state = await psp.get(opts.privateStateId);
      seen.push(state);
      await psp.set(opts.privateStateId, { ...state });
      return { public: { txHash: 'aa'.repeat(32), blockHeight: 1n } };
    };
    return { seen, callTx: { issueCredential: call, revokeCredential: call, proveCredential: call } };
  }),
}));
vi.mock('@midnight-ntwrk/midnight-js-network-id', () => ({ setNetworkId: () => undefined }));
// The compiled contract module pulls in WASM; only derivePk is needed here.
vi.mock('../../../contracts/managed/credentials/contract/index.js', () => ({
  Contract: class {},
  ledger: () => ({}),
  pureCircuits: { derivePk: (sk: Uint8Array) => sk },
}));
vi.mock('@midnight-ntwrk/midnight-js-protocol/compact-js', () => {
  const chain = { pipe: () => chain };
  return { CompiledContract: { make: () => chain, withWitnesses: () => chain, withCompiledFileAssets: () => chain } };
});

import { localStoragePrivateStateProvider } from './local-private-state-provider';
import { CredentialsApi, withSessionIssuerKey } from './credentials-api';
import { CREDENTIAL_PRIVATE_STATE_ID } from '../../../src/credentials';

const CONTRACT = 'c'.repeat(64);
const ISSUER_SK = '5e'.repeat(32);
const HOLDER_SK = '7a'.repeat(32);

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

/** Every localStorage entry under the app's prefixes, key and value. */
const dump = (store: Map<string, string>) =>
  [...store.entries()].filter(([k]) => k.startsWith('evidence-gateway/')).map(([k, v]) => `${k}=${v}`);

let store: Map<string, string>;
beforeEach(() => {
  store = installLocalStorage();
});

const providersWith = (privateStateProvider: any) => ({ privateStateProvider }) as any;

describe('issuer key stays out of localStorage', () => {
  it('after join + import + an issuer call, no localStorage entry contains the key; the circuit path still saw it', async () => {
    const api = await CredentialsApi.join(providersWith(localStoragePrivateStateProvider()), CONTRACT, 'preprod');
    await api.importIssuerKey(ISSUER_SK);
    expect(api.hasIssuerKey()).toBe(true);
    await api.ensureHolderKey(); // a persisted secret, to show the filter is selective
    await api.issueCredential(7001n, HOLDER_SK, 1n, 2_000_000_000n, 'SOC2 Type II — score 92');
    await api.revokeCredential(7001n);

    const entries = dump(store);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.join('\n')).not.toContain(ISSUER_SK);
    expect(entries.join('\n')).not.toContain('issuerSecretKeyHex');
    // The holder key and the credential material are persisted, as before.
    expect(entries.join('\n')).toContain('holderSecretKeyHex');
    expect(entries.join('\n')).toContain('"7001"');

    const deployed = (api as any).deployedContract;
    expect(deployed.seen).toHaveLength(2);
    for (const state of deployed.seen) expect(state.issuerSecretKeyHex).toBe(ISSUER_SK);
  });

  it('clearIssuerKey drops it from the circuit path too', async () => {
    const api = await CredentialsApi.join(providersWith(localStoragePrivateStateProvider()), CONTRACT, 'preprod');
    await api.importIssuerKey(ISSUER_SK);
    api.clearIssuerKey();
    expect(api.hasIssuerKey()).toBe(false);
    await api.revokeCredential(7001n);
    const deployed = (api as any).deployedContract;
    expect(deployed.seen[0].issuerSecretKeyHex).toBeUndefined();
  });

  it('a key persisted by an earlier version is removed on join and not carried into the session', async () => {
    const legacy = localStoragePrivateStateProvider<string, any>();
    legacy.setContractAddress(CONTRACT);
    await legacy.set(CREDENTIAL_PRIVATE_STATE_ID, { issuerSecretKeyHex: ISSUER_SK, holderSecretKeyHex: HOLDER_SK, credentials: {} });
    expect(dump(store).join('\n')).toContain(ISSUER_SK);

    const api = await CredentialsApi.join(providersWith(localStoragePrivateStateProvider()), CONTRACT, 'preprod');
    expect(api.removedPersistedIssuerKey).toBe(true);
    expect(api.hasIssuerKey()).toBe(false);
    expect(dump(store).join('\n')).not.toContain(ISSUER_SK);
    expect(dump(store).join('\n')).toContain(HOLDER_SK);
  });

  it('withSessionIssuerKey: set strips the key, get injects the session key, other ids pass through', async () => {
    const inner = localStoragePrivateStateProvider<string, any>();
    inner.setContractAddress(CONTRACT);
    const session: { issuerSecretKeyHex?: string } = {};
    const wrapped = withSessionIssuerKey(inner, session);
    await wrapped.set(CREDENTIAL_PRIVATE_STATE_ID, { issuerSecretKeyHex: ISSUER_SK, credentials: {} });
    expect(await inner.get(CREDENTIAL_PRIVATE_STATE_ID)).toEqual({ credentials: {} });
    expect(await wrapped.get(CREDENTIAL_PRIVATE_STATE_ID)).toEqual({ credentials: {} });
    session.issuerSecretKeyHex = ISSUER_SK;
    expect(await wrapped.get(CREDENTIAL_PRIVATE_STATE_ID)).toEqual({ credentials: {}, issuerSecretKeyHex: ISSUER_SK });
    await wrapped.set('other', { issuerSecretKeyHex: 'not-ours' });
    expect(await inner.get('other')).toEqual({ issuerSecretKeyHex: 'not-ours' });
  });
});
