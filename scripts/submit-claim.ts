/**
 * Submits one real compliance proof to a live network, non-interactively.
 *
 * This is the end-to-end demonstration of the whole project: the supplier's
 * PRIVATE score is fed to the local proof server as a witness, a zero-knowledge
 * proof is produced, and the only thing that reaches the chain is the proof
 * plus a +1 on the public counter. The score itself is never transmitted.
 *
 * Prints the public ledger state before and after, so the increment — and the
 * continued absence of the score — is visible in one place.
 *
 *   npm run claim -- --network preprod
 */
import '../src/env';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateWallet, getDeployment } from '../src/network';
import { createWallet, persistWalletState, type WalletContext } from '../src/wallet';
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

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateWallet(network).seed;

if (!isCompiled()) {
  console.error('\n❌ Contract not compiled. Run: npm run compile\n');
  process.exit(1);
}

const deployment = getDeployment(network);
if (!deployment) {
  console.error(`\n❌ No deployment on file for ${network}.\n`);
  process.exit(1);
}

const { module: ComplianceContract, compiledContract } = await loadCompiledContract();

function buildProviders(walletCtx: WalletContext) {
  const privateStatePassword =
    process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE_NAME,
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

async function readLedger(providers: any) {
  const state = await providers.publicDataProvider.queryContractState(deployment!.address);
  return state ? ComplianceContract.ledger(state.data) : null;
}

async function main() {
  console.log(`\n─── Submit compliance proof (${network}) ───────────────────────\n`);
  console.log(`  Contract: ${deployment!.address}`);
  console.log('  Private score: <withheld — supplied to the local prover only>\n');

  console.log('  Connecting wallet (restores from .midnight-wallet-state)...');
  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);
  console.log('  ✓ Synced.\n');

  const providers = buildProviders(walletCtx);

  const before = await readLedger(providers);
  console.log('  Public ledger BEFORE:');
  console.log(`    publicMinimumScore : ${before?.publicMinimumScore}`);
  console.log(`    verifiedClaims     : ${before?.verifiedClaims}\n`);

  console.log('  Connecting to contract...');
  const deployed: any = await findDeployedContract(providers, {
    compiledContract: compiledContract as any,
    contractAddress: deployment!.address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: createCompliancePrivateState(COMPLIANCE_SCORE),
  });

  console.log('  Proving and submitting (this can take a minute)...\n');
  const tx = await deployed.callTx.proveCompliance();

  console.log('  ✅ Compliance proven on-chain.');
  console.log(`     tx id        : ${tx.public.txId}`);
  console.log(`     block height : ${tx.public.blockHeight}\n`);

  const after = await readLedger(providers);
  console.log('  Public ledger AFTER:');
  console.log(`    publicMinimumScore : ${after?.publicMinimumScore}`);
  console.log(`    verifiedClaims     : ${after?.verifiedClaims}`);
  console.log('    supplier score     : NOT PRESENT — still absent from public state\n');

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
  console.log('─── Done ───────────────────────────────────────────────────────\n');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n❌ Claim failed:', err?.message ?? err);
  if (err?.cause) console.error('   cause:', err.cause?.message ?? err.cause);
  if (process.env.CLAIM_DEBUG) {
    console.error('\n--- stack ---');
    console.error(err?.stack ?? '(no stack)');
    if (err?.cause?.stack) { console.error('\n--- cause stack ---'); console.error(err.cause.stack); }
  }
  process.exit(1);
});
