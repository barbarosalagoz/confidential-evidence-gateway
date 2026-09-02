/**
 * Assembles the Midnight.js providers for the browser from a connected wallet.
 *
 * - ZK artifacts are fetched from this site's own origin (/keys, /zkir).
 * - Proving is delegated to the wallet when it supports getProvingProvider
 *   (the current, non-deprecated path); otherwise falls back to the proof
 *   server URI the wallet advertises in its configuration.
 * - Balancing and submission go through the wallet: the DApp never sees keys.
 * - Private state lives in localStorage on this machine only.
 */
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  createProofProvider,
  type MidnightProvider,
  type ProofProvider,
  type UnboundTransaction,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  Transaction,
  type Binding,
  type FinalizedTransaction,
  type Proof,
  type SignatureEnabled,
  type TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex, parseCoinPublicKeyToHex, parseEncPublicKeyToHex } from '@midnight-ntwrk/midnight-js-utils';
import { localStoragePrivateStateProvider } from './local-private-state-provider';
import type { EvidencePrivateState } from '../../../src/evidence';

export type EvidenceCircuitKeys = 'registerEvidence' | 'proveEvidence';

export type EvidenceProviders = {
  privateStateProvider: ReturnType<typeof localStoragePrivateStateProvider<string, EvidencePrivateState>>;
  zkConfigProvider: FetchZkConfigProvider<EvidenceCircuitKeys>;
  proofProvider: ProofProvider;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
};

async function makeProofProvider(
  api: ConnectedAPI,
  zkConfigProvider: FetchZkConfigProvider<EvidenceCircuitKeys>,
): Promise<{ proofProvider: ProofProvider; mode: 'wallet' | 'proof-server' }> {
  try {
    const provingProvider = await api.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
    return { proofProvider: createProofProvider(provingProvider), mode: 'wallet' };
  } catch (err) {
    const config = await api.getConfiguration();
    if (!config.proverServerUri) {
      throw new Error(
        'Wallet offers no proving provider and no proof server URI. ' +
          'Configure a proof server in Lace, then reconnect. ' +
          `(getProvingProvider failed: ${err instanceof Error ? err.message : String(err)})`,
      );
    }
    return { proofProvider: httpClientProofProvider(config.proverServerUri, zkConfigProvider), mode: 'proof-server' };
  }
}

export async function buildProviders(
  api: ConnectedAPI,
  networkId: string,
  log: (message: string) => void,
): Promise<EvidenceProviders> {
  const config = await api.getConfiguration();
  log(`Wallet services — indexer: ${config.indexerUri}`);

  const zkConfigProvider = new FetchZkConfigProvider<EvidenceCircuitKeys>(
    window.location.origin,
    fetch.bind(window),
  );

  const { proofProvider, mode } = await makeProofProvider(api, zkConfigProvider);
  log(mode === 'wallet' ? 'Proving delegated to the wallet.' : 'Proving via configured proof server.');

  const shielded = await api.getShieldedAddresses();
  const coinPublicKeyHex = parseCoinPublicKeyToHex(shielded.shieldedCoinPublicKey, networkId);
  const encryptionPublicKeyHex = parseEncPublicKeyToHex(shielded.shieldedEncryptionPublicKey, networkId);

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => coinPublicKeyHex,
    getEncryptionPublicKey: () => encryptionPublicKeyHex,
    async balanceTx(tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction> {
      void ttl; // the wallet applies its own TTL policy
      const { tx: balanced } = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
      return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
        'signature',
        'proof',
        'binding',
        fromHex(balanced),
      ) as FinalizedTransaction;
    },
  };

  const midnightProvider: MidnightProvider = {
    async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      await api.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };

  return {
    privateStateProvider: localStoragePrivateStateProvider<string, EvidencePrivateState>(),
    zkConfigProvider,
    proofProvider,
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    walletProvider,
    midnightProvider,
  };
}
