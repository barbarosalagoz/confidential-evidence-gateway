/**
 * End-to-end smoke check for the Confidential Compliance Proof contract.
 *
 * Reconnects to the deployed contract, reads its public ledger state, asserts
 * the state exposes only the policy threshold and the verified-claim count,
 * and exits 0 on success. Used by `npm run test:e2e`.
 */
import '../src/env'; // side effect: load .env before any process.env read


import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment } from '../src/network';
import { createWallet, persistWalletState } from '../src/wallet';
import { loadCompiledContract, isCompiled } from '../src/compiled-contract';
import {
  createCompliancePrivateState,
  parseMinimumScore,
  PRIVATE_STATE_ID,
  PRIVATE_STATE_STORE_NAME,
  zkConfigPath,
} from '../src/compliance';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const COMPLIANCE_SCORE = parseMinimumScore(process.env.COMPLIANCE_SCORE, 85n);

// ─── Network configuration ─────────────────────────────────────────────────────

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

function fail(msg: string): never {
  console.error(`❌ e2e-check failed: ${msg}`);
  process.exit(1);
}

function isHexAddress(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length >= 32;
}

async function main() {
  // 1. Deployment sanity
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}.`);
    process.exit(1);
  }
  if (!isHexAddress(deployment.address)) {
    fail(`Deployment address missing or invalid: ${JSON.stringify(deployment, null, 2)}`);
  }

  // 2. Build wallet and providers
  if (!isCompiled()) fail('Compiled contract missing — run `npm run compile`.');
  const { module: ComplianceContract, compiledContract } = await loadCompiledContract();

  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  await walletCtx.wallet.waitForSyncedState();
  // Persist the sync state — saves time on the next e2e-check invocation in CI
  // when run against the same persistent wallet directory.
  await persistWalletState(network, walletCtx);

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const walletProvider = {
    // Midnight.js 4.1.x returns the key objects (CoinPublicKey / EncPublicKey).
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx() {
      throw new Error('e2e-check is read-only and should not balance transactions');
    },
    submitTx() {
      throw new Error('e2e-check is read-only and should not submit transactions');
    },
  } as any;

  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE_NAME,
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      // SDK requires ≥16 chars. e2e-check is read-only so we don't expose
      // the env-var override here — match the deploy script's local-devnet default.
      privateStoragePasswordProvider: () => 'Local-Devnet-Development-Placeholder-1',
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  // 3. Reconnect to the deployed contract — proves callTx interface is wired
  try {
    await findDeployedContract(providers, {
      contractAddress: deployment.address,
      compiledContract: compiledContract as any,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: createCompliancePrivateState(COMPLIANCE_SCORE),
    });
  } catch (err: any) {
    await walletCtx.wallet.stop();
    fail(`findDeployedContract threw: ${err?.message ?? err}`);
  }

  // 4. Read the on-chain contract state via the public data provider — proves
  // the contract is indexed and queryable on the chain itself, not just that
  // we know how to construct the local handle.
  const onChainState = await providers.publicDataProvider.queryContractState(deployment.address);
  if (!onChainState) {
    await walletCtx.wallet.stop();
    fail(`queryContractState returned null for ${deployment.address}`);
  }

  // 5. The public state must expose the policy threshold and the claim count
  //    — and nothing shaped like a supplier score.
  const ledgerState = ComplianceContract.ledger(onChainState.data);
  const publicFields = Object.keys(ledgerState);
  const expected = ['publicMinimumScore', 'verifiedClaims'];
  const unexpected = publicFields.filter((k) => !expected.includes(k));
  if (unexpected.length > 0) {
    await walletCtx.wallet.stop();
    fail(`Public ledger exposes unexpected fields: ${unexpected.join(', ')}`);
  }

  console.log(`✅ e2e-check passed`);
  console.log(`   contractAddress:    ${deployment.address}`);
  console.log(`   network:            ${network}`);
  console.log(`   publicMinimumScore: ${ledgerState.publicMinimumScore}`);
  console.log(`   verifiedClaims:     ${ledgerState.verifiedClaims}`);
  console.log(`   private score on chain: none (by design)`);

  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
