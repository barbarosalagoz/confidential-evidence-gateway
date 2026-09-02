/**
 * Lace wallet connection via the Midnight DApp Connector API (4.x).
 *
 * Wallets inject InitialAPI instances under window.midnight keyed by UUID, so
 * we enumerate rather than reach for a fixed key, and filter by a semver check
 * on apiVersion — the pattern documented in the official React wallet guide.
 */
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import semver from 'semver';

const COMPATIBLE_CONNECTOR_API_VERSION = '4.x';

declare global {
  interface Window {
    midnight?: Record<string, InitialAPI>;
  }
}

export function listCompatibleWallets(): InitialAPI[] {
  const injected = window.midnight;
  if (!injected) return [];
  return Object.values(injected).filter(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet === 'object' &&
      'apiVersion' in wallet &&
      semver.satisfies(String(wallet.apiVersion), COMPATIBLE_CONNECTOR_API_VERSION, {
        includePrerelease: true,
      }),
  );
}

export interface WalletSession {
  readonly api: ConnectedAPI;
  readonly walletName: string;
  readonly unshieldedAddress: string;
  readonly networkId: string;
}

/** Polls briefly for wallet injection, then connects to the requested network. */
export async function connectWallet(networkId: string): Promise<WalletSession> {
  let wallet: InitialAPI | undefined;
  for (let attempt = 0; attempt < 10 && !wallet; attempt++) {
    wallet = listCompatibleWallets()[0];
    if (!wallet) await new Promise((r) => setTimeout(r, 100));
  }
  if (!wallet) {
    throw new Error(
      'No Midnight wallet with connector API 4.x found. Install the Lace (Midnight) extension and reload.',
    );
  }

  const api = await wallet.connect(networkId);

  const status = await api.getConnectionStatus();
  if (status.status !== 'connected') {
    throw new Error('Wallet refused the connection. Approve the DApp in Lace and try again.');
  }
  if (status.networkId && status.networkId !== networkId) {
    throw new Error(
      `Wallet is on network "${status.networkId}" but this app targets "${networkId}". Switch the network in Lace.`,
    );
  }

  const { unshieldedAddress } = await api.getUnshieldedAddress();
  return { api, walletName: wallet.name, unshieldedAddress, networkId };
}
