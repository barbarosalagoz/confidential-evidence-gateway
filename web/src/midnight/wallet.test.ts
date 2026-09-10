import { describe, it, expect, beforeEach } from 'vitest';
import { listCompatibleWallets, connectWallet } from './wallet';

type FakeWallet = {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
  connect: (networkId: string) => Promise<any>;
};

function fakeWallet(apiVersion: string, overrides: Partial<FakeWallet> = {}): FakeWallet {
  return {
    rdns: 'io.lace.test',
    name: 'Lace',
    icon: 'data:,',
    apiVersion,
    connect: async () => ({
      getConnectionStatus: async () => ({ status: 'connected', networkId: 'preprod' }),
      getUnshieldedAddress: async () => ({ unshieldedAddress: 'mn_addr_preprod1test' }),
    }),
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as any).window = {};
});

describe('wallet discovery (DApp connector 4.x)', () => {
  it('returns nothing when no wallet is injected', () => {
    expect(listCompatibleWallets()).toEqual([]);
    (globalThis as any).window.midnight = {};
    expect(listCompatibleWallets()).toEqual([]);
  });

  it('enumerates window.midnight by UUID key and keeps only connector API 4.x', () => {
    (globalThis as any).window.midnight = {
      'a1b2c3d4-uuid': fakeWallet('4.0.1'),
      'e5f6-uuid': fakeWallet('3.1.5', { name: 'OldLace' }),
      'not-a-wallet': { foo: 'bar' },
    };
    const wallets = listCompatibleWallets();
    expect(wallets.map((w) => w.apiVersion)).toEqual(['4.0.1']);
  });

  it('does not depend on a hardcoded mnLace key', () => {
    (globalThis as any).window.midnight = { mnLace: fakeWallet('2.0.0'), 'random-uuid': fakeWallet('4.1.0-canary.1') };
    expect(listCompatibleWallets().map((w) => w.apiVersion)).toEqual(['4.1.0-canary.1']);
  });
});

describe('connectWallet', () => {
  it('connects, checks status and reads the unshielded address', async () => {
    (globalThis as any).window.midnight = { 'uuid-1': fakeWallet('4.0.1') };
    const session = await connectWallet('preprod');
    expect(session.walletName).toBe('Lace');
    expect(session.unshieldedAddress).toBe('mn_addr_preprod1test');
    expect(session.networkId).toBe('preprod');
  });

  it('refuses a wallet on a different network', async () => {
    (globalThis as any).window.midnight = {
      'uuid-1': fakeWallet('4.0.1', {
        connect: async () => ({
          getConnectionStatus: async () => ({ status: 'connected', networkId: 'preview' }),
          getUnshieldedAddress: async () => ({ unshieldedAddress: 'x' }),
        }),
      }),
    };
    await expect(connectWallet('preprod')).rejects.toThrow(/network "preview"/);
  });

  it('explains when no compatible wallet exists', async () => {
    (globalThis as any).window.midnight = { 'uuid-1': fakeWallet('3.0.0') };
    await expect(connectWallet('preprod')).rejects.toThrow(/connector API 4.x/);
  });
});
