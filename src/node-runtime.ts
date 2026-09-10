/**
 * Shared Node-side runtime for the Level 3 scripts: wallet bootstrap (create,
 * sync, faucet wait, DUST registration) and Midnight.js provider assembly.
 * Extracted from the Level 1/2 deploy scripts, which remain untouched.
 */
import './env';

import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, type NetworkConfig, type NetworkId } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

export interface BootstrappedWallet {
  readonly network: NetworkId;
  readonly networkConfig: NetworkConfig;
  readonly walletCtx: WalletContext;
  readonly address: string;
}

/** Creates/restores the network wallet, syncs it, and ensures NIGHT + DUST. */
export async function bootstrapWallet(opts: { requireFunds?: boolean } = {}): Promise<BootstrappedWallet> {
  const { network, config: networkConfig } = resolveNetwork();
  const wallet = getOrCreateWallet(network);
  const notice = formatWalletBackupNotice(wallet, network);
  if (notice) console.log(notice);

  const walletCtx = await createWallet({ network, networkConfig, seed: wallet.seed });
  console.log('  Syncing wallet (RPC disconnect messages are normal)...');
  const syncStart = Date.now();
  const ticker = setInterval(() => {
    process.stdout.write(`\r  ⏳ Still syncing... (${Math.round((Date.now() - syncStart) / 1000)}s)   `);
  }, 5000);
  const state = await walletCtx.wallet.waitForSyncedState();
  clearInterval(ticker);
  process.stdout.write('\r  ✓ Synced.                                   \n');
  await persistWalletState(network, walletCtx);

  const address = walletCtx.unshieldedKeystore.getBech32Address().toString();
  const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`  Wallet:  ${address}`);
  console.log(`  Balance: ${balance.toLocaleString()} tNight`);

  if (opts.requireFunds === false) return { network, networkConfig, walletCtx, address };

  if (network !== 'undeployed' && networkConfig.faucet && balance === 0n) {
    console.log(`\n  Fund this address at ${networkConfig.faucet} — polling every 10s...`);
    const timeoutMs = Number(process.env.MIDNIGHT_FAUCET_TIMEOUT_MS) || 600_000;
    const start = Date.now();
    while (true) {
      await new Promise((r) => setTimeout(r, 10_000));
      const s = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((x) => x.isSynced)));
      if ((s.unshielded.balances[unshieldedToken().raw] ?? 0n) > 0n) break;
      if (Date.now() - start > timeoutMs) {
        await walletCtx.wallet.stop();
        throw new Error('Funding not received in time. Re-run after funding — the seed is preserved.');
      }
    }
    console.log('  Funded.');
  }

  const dustState = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const unregistered = dustState.unshielded.availableCoins.filter((c: any) => !c.meta?.registeredForDustGeneration);
  if (unregistered.length > 0) {
    console.log(`  Registering ${unregistered.length} NIGHT UTXOs for DUST generation...`);
    let recipe: Awaited<ReturnType<typeof walletCtx.wallet.registerNightUtxosForDustGeneration>> | undefined;
    for (let attempt = 1; ; attempt++) {
      try {
        recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
          unregistered,
          walletCtx.unshieldedKeystore.getPublicKey(),
          (payload) => walletCtx.unshieldedKeystore.signData(payload),
        );
        break;
      } catch (err: any) {
        const needed = /need (\d+)/.exec(`${err?.message ?? err}`)?.[1];
        const canWait = typeof (walletCtx.wallet as any).waitForGeneratedDust === 'function';
        if (!needed || !canWait || attempt >= 10) throw err;
        await (walletCtx.wallet as any).waitForGeneratedDust(unregistered, BigInt(needed));
      }
    }
    await walletCtx.wallet.submitTransaction(await walletCtx.wallet.finalizeRecipe(recipe));
  }
  if (dustState.dust.balance(new Date()) === 0n) {
    console.log('  Waiting for DUST...');
    await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(
        Rx.throttleTime(5000),
        Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n),
      ),
    );
  }
  return { network, networkConfig, walletCtx, address };
}

export async function waitForProofServer(url: string, maxAttempts = 30): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
      return true;
    } catch (err: any) {
      const code = err?.cause?.code || err?.code || '';
      if (!['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** Midnight.js providers over the bootstrapped wallet. */
export function makeProviders(boot: BootstrappedWallet, zkConfigPath: string, storeName: string) {
  const { walletCtx, networkConfig } = boot;
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
      privateStateStoreName: storeName,
      accountId: boot.address,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

/** Same DUST projection pause as the Level 1/2 deploys. */
export async function settleDust(): Promise<void> {
  await new Promise((r) => setTimeout(r, 6000));
}

export function isDustShortage(err: unknown): boolean {
  const e = err as any;
  const s = `${e?.message ?? ''} ${e?.cause?.message ?? ''}`;
  return s.includes('Not enough Dust') || s.includes('Insufficient Funds') || s.includes('could not balance dust');
}
