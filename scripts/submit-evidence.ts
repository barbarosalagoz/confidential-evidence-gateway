/**
 * Submit real circuit calls to the deployed evidence registry:
 *   registerEvidence(controlId) then proveEvidence(controlId).
 *
 * Usage: npm run submit:evidence -- --network preprod [--control 1001] [--content "..."]
 *
 * The evidence content is hashed locally; digest + salt go into the local
 * private-state store and reach the chain only as an opaque commitment.
 */
import '../src/env';

import { WebSocket } from 'ws';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNetwork, getOrCreateWallet } from '../src/network';
import { createWallet, persistWalletState, type WalletContext } from '../src/wallet';
import { loadEvidenceContract, evidenceZkConfigPath } from '../src/evidence-node';
import {
  createEvidencePrivateState,
  createEvidenceRecord,
  withEvidenceRecord,
  parseControlId,
  EVIDENCE_PRIVATE_STATE_ID,
  EVIDENCE_PRIVATE_STATE_STORE_NAME,
  type EvidencePrivateState,
} from '../src/evidence';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

const controlId = parseControlId(argValue('--control') ?? '1001');
const content =
  argValue('--content') ??
  'SOC2 CC6.1 — access-control review 2026-Q3: PASSED (internal audit ref #4471). CONFIDENTIAL.';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const deploymentPath = path.resolve(moduleDir, '..', 'deployments', `evidence.${network}.json`);
if (!fs.existsSync(deploymentPath)) {
  console.error(`No deployment file at ${deploymentPath}. Run: npm run deploy:evidence -- --network ${network}`);
  process.exit(1);
}
const contractAddress = (JSON.parse(fs.readFileSync(deploymentPath, 'utf-8')) as { contractAddress: string })
  .contractAddress;

async function createProviders(walletCtx: WalletContext) {
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
  const zkConfigProvider = new NodeZkConfigProvider(evidenceZkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: EVIDENCE_PRIVATE_STATE_STORE_NAME,
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

async function main() {
  console.log(`\nSubmitting evidence circuit calls on ${network}`);
  console.log(`  Contract: ${contractAddress}`);
  console.log(`  Control:  ${controlId}`);
  console.log('  Content:  <withheld — hashed locally, never transmitted>\n');

  const walletCtx = await createWallet({ network, networkConfig, seed: getOrCreateWallet(network).seed });
  console.log('  Syncing wallet...');
  await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);
  console.log('  Synced.\n');

  const providers = await createProviders(walletCtx);
  const { compiledContract } = await loadEvidenceContract();

  const deployed = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: compiledContract as any,
    privateStateId: EVIDENCE_PRIVATE_STATE_ID,
    initialPrivateState: createEvidencePrivateState(),
  });

  // Store the evidence record AFTER joining: findDeployedContract writes
  // initialPrivateState to the store, so anything set before it is lost.
  // (Same order the web frontend uses.)
  providers.privateStateProvider.setContractAddress(contractAddress);
  const existing =
    ((await providers.privateStateProvider.get(EVIDENCE_PRIVATE_STATE_ID)) as EvidencePrivateState | null) ??
    createEvidencePrivateState();
  const record = await createEvidenceRecord(content);
  await providers.privateStateProvider.set(
    EVIDENCE_PRIVATE_STATE_ID,
    withEvidenceRecord(existing, controlId, record),
  );
  console.log('  Local evidence record stored (digest + salt, this machine only).');

  console.log('\n  Calling registerEvidence()...');
  const reg = await (deployed as any).callTx.registerEvidence(controlId);
  console.log(`  ✓ registerEvidence tx ${reg.public.txHash} (block ${reg.public.blockHeight})`);

  console.log('\n  Calling proveEvidence()...');
  const prove = await (deployed as any).callTx.proveEvidence(controlId);
  console.log(`  ✓ proveEvidence tx ${prove.public.txHash} (block ${prove.public.blockHeight})`);

  console.log('\n  Done. Read it back as an observer: npm run verify:evidence -- --network ' + network + '\n');
  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
