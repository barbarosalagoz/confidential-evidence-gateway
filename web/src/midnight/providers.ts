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
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

export type EvidenceCircuitKeys =
  | 'registerEvidence'
  | 'proveEvidence'
  | 'issueCredential'
  | 'revokeCredential'
  | 'proveCredential';

/** One instance per joined contract: the private-state scope is per contract. */
export type EvidenceProviders = {
  // Private state shape differs per contract (evidence vs credentials).
  privateStateProvider: PrivateStateProvider<string, any>;
  zkConfigProvider: FetchZkConfigProvider<EvidenceCircuitKeys>;
  proofProvider: ProofProvider;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
};

/**
 * How proofs are produced.
 *  - 'wallet': delegate to Lace via getProvingProvider() (Lace talks to the
 *    proof server it is configured with — local or remote).
 *  - 'proof-server': this app calls a proof server directly over HTTP
 *    (default http://localhost:6300 — the local container; CORS verified for
 *    this origin). Bypasses the extension's message channel entirely.
 */
export type ProvingMode = 'wallet' | 'proof-server';

export interface ProvingOptions {
  mode: ProvingMode;
  /** Only for 'proof-server'; falls back to the wallet's advertised proverServerUri. */
  proofServerUrl?: string;
}

export const DEFAULT_LOCAL_PROOF_SERVER = 'http://localhost:6300';

/** Wraps a stage so failures carry the stage name and timing, with the original as `cause`. */
async function staged<T>(log: (m: string) => void, stage: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  log(`${stage}: started`);
  try {
    const result = await work();
    log(`${stage}: done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
    return result;
  } catch (err) {
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    const inner = err instanceof Error ? err : new Error(String(err));
    throw new Error(`${stage} failed after ${elapsed}s: ${inner.message || '(empty error from the wallet/prover)'}`, {
      cause: err,
    });
  }
}

async function makeProofProvider(
  api: ConnectedAPI,
  zkConfigProvider: FetchZkConfigProvider<EvidenceCircuitKeys>,
  proving: ProvingOptions,
  log: (m: string) => void,
): Promise<{ proofProvider: ProofProvider; description: string }> {
  const config = await api.getConfiguration();
  if (proving.mode === 'proof-server') {
    const url = proving.proofServerUrl?.trim() || config.proverServerUri || DEFAULT_LOCAL_PROOF_SERVER;
    return { proofProvider: httpClientProofProvider(url, zkConfigProvider), description: `app → proof server ${url}` };
  }
  try {
    const provingProvider = await api.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
    return {
      proofProvider: createProofProvider(provingProvider),
      description: 'delegated to the wallet (Lace proves with its own configured proof server)',
    };
  } catch (err) {
    log(`Wallet proving provider unavailable (${err instanceof Error ? err.message : String(err)}); falling back.`);
    const url = config.proverServerUri || DEFAULT_LOCAL_PROOF_SERVER;
    return { proofProvider: httpClientProofProvider(url, zkConfigProvider), description: `app → proof server ${url} (fallback)` };
  }
}

export async function buildProviders(
  api: ConnectedAPI,
  networkId: string,
  log: (message: string) => void,
  proving: ProvingOptions = { mode: 'wallet' },
): Promise<EvidenceProviders> {
  const config = await api.getConfiguration();
  log(`Wallet services — indexer: ${config.indexerUri}${config.proverServerUri ? ` · wallet proverServerUri: ${config.proverServerUri}` : ''}`);

  const zkConfigProvider = new FetchZkConfigProvider<EvidenceCircuitKeys>(
    window.location.origin,
    fetch.bind(window),
  );

  const { proofProvider: rawProofProvider, description } = await makeProofProvider(api, zkConfigProvider, proving, log);
  log(`Proving: ${description}.`);

  // Stage instrumentation: proving, balancing and submission each log their
  // duration, and a failure names the stage — the SDK's own wrapper only
  // says "submitting scoped transaction".
  const proofProvider: ProofProvider = {
    proveTx: (unprovenTx, cfg) => staged(log, 'proving', () => rawProofProvider.proveTx(unprovenTx, cfg)),
  };

  const shielded = await api.getShieldedAddresses();
  const coinPublicKeyHex = parseCoinPublicKeyToHex(shielded.shieldedCoinPublicKey, networkId);
  const encryptionPublicKeyHex = parseEncPublicKeyToHex(shielded.shieldedEncryptionPublicKey, networkId);

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => coinPublicKeyHex,
    getEncryptionPublicKey: () => encryptionPublicKeyHex,
    balanceTx(tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction> {
      void ttl; // the wallet applies its own TTL policy
      return staged(log, 'balancing (wallet)', async () => {
        const { tx: balanced } = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          'signature',
          'proof',
          'binding',
          fromHex(balanced),
        ) as FinalizedTransaction;
      });
    },
  };

  const midnightProvider: MidnightProvider = {
    submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      return staged(log, 'submitting (wallet)', async () => {
        await api.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      });
    },
  };

  return {
    privateStateProvider: localStoragePrivateStateProvider<string, any>(),
    zkConfigProvider,
    proofProvider,
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    walletProvider,
    midnightProvider,
  };
}
