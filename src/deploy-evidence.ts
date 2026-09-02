/**
 * Deploy the Compliance-Evidence Commitment contract (Level 2) to a Midnight
 * network (undeployed by default; --network preview|preprod for public nets).
 *
 * Deploying publishes nothing private: the registry starts empty. Evidence
 * records are created later, client-side, and only their commitments ever
 * reach the chain.
 *
 * On success the address is written to deployments/evidence.<network>.json
 * (committed) so the web frontend can join the same contract.
 */
import './env'; // side effect: load .env before any process.env read

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { loadEvidenceContract, isEvidenceCompiled, evidenceZkConfigPath } from './evidence-node';
import {
  createEvidencePrivateState,
  EVIDENCE_PRIVATE_STATE_ID,
  EVIDENCE_PRIVATE_STATE_STORE_NAME,
} from './evidence';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const deploymentsDir = path.resolve(moduleDir, '..', 'deployments');

async function waitForProofServer(maxAttempts = 60, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(networkConfig.proofServer, { method: 'GET', signal: AbortSignal.timeout(3000) });
      return true;
    } catch (err: any) {
      const code = err?.cause?.code || err?.code || '';
      if (code !== 'ECONNREFUSED' && code !== 'UND_ERR_CONNECT_TIMEOUT' && code !== 'UND_ERR_SOCKET') {
        return true;
      }
    }
    if (attempt < maxAttempts) {
      process.stdout.write(`\r  Waiting for proof server... (${attempt}/${maxAttempts})   `);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

if (!isEvidenceCompiled()) {
  console.error('\n❌ Contract not compiled! Run: npm run compile:evidence\n');
  process.exit(1);
}

const { compiledContract } = await loadEvidenceContract();

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
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: EVIDENCE_PRIVATE_STATE_STORE_NAME,
      accountId,
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
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  Deploy Compliance-Evidence Commitment Registry to ${network}`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('─── Wallet setup ───────────────────────────────────────────────\n');
  const walletCtx = await createWallet({ network, networkConfig, seed: WALLET.seed });
  const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
  if (restoredCount > 0) {
    console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state.`);
  }

  console.log('  Syncing with network (RPC disconnect messages are normal)...');
  const syncStart = Date.now();
  const syncInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - syncStart) / 1000);
    process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
  }, 5000);
  const state = await walletCtx.wallet.waitForSyncedState();
  clearInterval(syncInterval);
  process.stdout.write('\r  ✓ Synced with network.                                      \n');
  await persistWalletState(network, walletCtx);

  const address = walletCtx.unshieldedKeystore.getBech32Address();
  const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`\n  Wallet Address: ${address}`);
  console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

  if (network !== 'undeployed' && networkConfig.faucet && balance === 0n) {
    console.log('─── Fund Wallet ────────────────────────────────────────────────\n');
    console.log(`  Wallet address: ${address}`);
    console.log(`  Faucet:         ${networkConfig.faucet}\n`);
    console.log('  Waiting for tNIGHT to arrive (poll every 10s)...');
    const rawTimeout = Number(process.env.MIDNIGHT_FAUCET_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 600_000;
    const start = Date.now();
    while (true) {
      await new Promise((r) => setTimeout(r, 10_000));
      const s = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((x) => x.isSynced)));
      const tn = s.unshielded.balances[unshieldedToken().raw] ?? 0n;
      if (tn > 0n) {
        console.log(`\n  Funded! tNIGHT balance: ${tn.toLocaleString()}\n`);
        break;
      }
      if (Date.now() - start > timeoutMs) {
        console.log(`\n  ❌ Funding not received within ${Math.round(timeoutMs / 60_000)} min. Re-run after funding.\n`);
        await walletCtx.wallet.stop();
        process.exit(1);
      }
      process.stdout.write(`\r  ...still waiting (${Math.round((Date.now() - start) / 1000)}s elapsed)`);
    }
  }

  // DUST registration — same flow as Level 1 deploy.
  console.log('─── DUST Token Setup ───────────────────────────────────────────\n');
  const dustState = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const unregisteredUtxos = dustState.unshielded.availableCoins.filter(
    (c: any) => !c.meta?.registeredForDustGeneration,
  );
  if (unregisteredUtxos.length > 0) {
    console.log(`  Registering ${unregisteredUtxos.length} NIGHT UTXOs for DUST generation...`);
    const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
      unregisteredUtxos,
      walletCtx.unshieldedKeystore.getPublicKey(),
      (payload) => walletCtx.unshieldedKeystore.signData(payload),
    );
    const finalized = await walletCtx.wallet.finalizeRecipe(recipe);
    await walletCtx.wallet.submitTransaction(finalized);
  }
  if (dustState.dust.balance(new Date()) === 0n) {
    console.log('  Waiting for DUST tokens...');
    await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(
        Rx.throttleTime(5000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    );
  }
  console.log('  DUST tokens ready!\n');

  console.log('─── Deploy Contract ────────────────────────────────────────────\n');
  console.log('  Checking proof server...');
  if (!(await waitForProofServer())) {
    console.log('\n  ❌ Proof server not responding. Run: docker compose up -d\n');
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  process.stdout.write('\r  Proof server ready!                                 \n');

  const providers = await createProviders(walletCtx);

  process.stdout.write('  Generating DUST...');
  await new Promise((r) => setTimeout(r, 6000));
  process.stdout.write(' done.\n');
  console.log('  Deploying contract...\n');

  const MAX_RETRIES = 20;
  const RETRY_DELAY_MS = 5000;
  let deployed: Awaited<ReturnType<typeof deployContract>> | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // No constructor args; the registry starts empty. The initial private
      // state has no records yet — they are added per-control by clients.
      deployed = await deployContract(providers, {
        compiledContract: compiledContract as any,
        args: [],
        privateStateId: EVIDENCE_PRIVATE_STATE_ID,
        initialPrivateState: createEvidencePrivateState(),
      });
      break;
    } catch (err: any) {
      const fullError = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`;
      const isDustShortage =
        fullError.includes('Not enough Dust') ||
        fullError.includes('Insufficient Funds') ||
        fullError.includes('could not balance dust');
      if (!(isDustShortage && attempt === 1)) {
        console.error(`\n  Attempt ${attempt} error: ${err?.message}`);
      }
      if (isDustShortage && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else if (isDustShortage) {
        console.log(`  ❌ Not enough DUST after ${MAX_RETRIES} retries.`);
        await walletCtx.wallet.stop();
        process.exit(1);
      } else {
        throw err;
      }
    }
  }
  if (!deployed) throw new Error('Deployment failed after all retries');

  const contractAddress = deployed.deployTxData.public.contractAddress;
  const txId = (deployed.deployTxData.public as any).txId ?? (deployed.deployTxData.public as any).txHash;
  const blockHeight = (deployed.deployTxData.public as any).blockHeight;
  console.log('  ✅ Contract deployed successfully!\n');
  console.log(`  Contract Address: ${contractAddress}`);
  console.log(`  Deploy tx:        ${txId} (block ${blockHeight})\n`);

  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outPath = path.join(deploymentsDir, `evidence.${network}.json`);
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        network,
        contractAddress,
        deployTxId: `${txId ?? ''}`,
        blockHeight: `${blockHeight ?? ''}`,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  Recorded in ${path.relative(process.cwd(), outPath)} — commit this file.\n`);

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
  console.log('─── Deployment complete ────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
