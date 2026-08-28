/**
 * Prints the wallet address for a network, without syncing.
 *
 * `npm run setup` only prints the address after a full chain sync, which on a
 * fresh Preprod wallet can take many minutes — and you cannot start funding
 * from the faucet until you have the address. Derivation is purely local
 * (seed -> HD key -> bech32), so this reads the stored seed and prints the
 * address immediately, letting the faucet request run in parallel with sync.
 *
 * Read-only: it does not create a wallet, touch the network, or modify state.
 * It deliberately prints ONLY the address — never the seed or recovery phrase.
 */
import '../src/env';
import { Buffer } from 'buffer';
import { HDWallet, Roles, createKeystore } from '@midnight-ntwrk/wallet-sdk';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { resolveNetwork, loadState } from '../src/network';

const { network, config } = resolveNetwork();

const state = loadState();
const seed = state?.wallets?.[network]?.seed;

if (!seed) {
  console.error(
    `\nNo wallet on file for network "${network}".\n` +
      `Run \`npm run setup -- --network ${network}\` first — it generates one.\n`,
  );
  process.exit(1);
}

setNetworkId(config.networkId);

const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
if (hd.type !== 'seedOk') throw new Error('Invalid seed in .midnight-state.json');

const derived = hd.hdWallet.selectAccount(0).selectRoles([Roles.NightExternal]).deriveKeysAt(0);
if (derived.type !== 'keysDerived') throw new Error('Key derivation failed');
hd.hdWallet.clear();

const address = createKeystore(derived.keys[Roles.NightExternal], getNetworkId()).getBech32Address();

console.log(`\n  Network:        ${network}`);
console.log(`  Wallet address: ${address}`);
if (config.faucet) console.log(`  Faucet:         ${config.faucet}`);
console.log('\n  Safe to share: this is a public address on a test network.');
console.log('  Never share the recovery phrase in .midnight-state.json.\n');
