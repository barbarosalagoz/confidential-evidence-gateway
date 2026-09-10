/**
 * Observer view of the credentials registry — no wallet, no sync. Prints the
 * complete public state and derives each credential's status the way a
 * verifier would, from public data plus the verifier's own clock.
 */
import '../src/env';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { resolveNetwork } from '../src/network';
import { loadCredentialsContract } from '../src/credentials-node';
import { bytesToHex, credentialStatus } from '../src/credentials';

const { network, config } = resolveNetwork();
setNetworkId(config.networkId);

function resolveAddress(): string | null {
  const idx = process.argv.indexOf('--address');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const p = path.resolve(moduleDir, '..', 'deployments', `credentials.${network}.json`);
  return fs.existsSync(p) ? ((JSON.parse(fs.readFileSync(p, 'utf-8')) as any).contractAddress ?? null) : null;
}

const address = resolveAddress();
if (!address) {
  console.error(`\nNo credentials deployment for ${network}. Run: npm run deploy:credentials -- --network ${network}\n`);
  process.exit(1);
}

const query = `{ contractAction(address: "${address}") { __typename address state transaction { hash block { height timestamp } } } }`;
const res = await fetch(config.indexer, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const body = (await res.json()) as any;
if (body.errors) {
  console.error('Indexer error:', JSON.stringify(body.errors));
  process.exit(1);
}
const action = body.data?.contractAction;
if (!action) {
  console.error(`\n❌ Indexer has no contract at ${address} on ${network}.\n`);
  process.exit(1);
}

const { module } = await loadCredentialsContract();
const ledger = module.ledger(ContractState.deserialize(Uint8Array.from(Buffer.from(action.state, 'hex'))).data);
const block = action.transaction?.block ?? {};
const now = BigInt(Math.floor(Date.now() / 1000));

console.log('\n=== Latest on-chain action =====================================');
console.log(`  network        : ${network}`);
console.log(`  contract       : ${action.address}`);
console.log(`  action type    : ${action.__typename}`);
console.log(`  tx hash        : ${action.transaction?.hash}`);
console.log(`  block height   : ${block.height}`);
console.log(`  block time     : ${block.timestamp ? new Date(block.timestamp).toISOString() : 'n/a'}`);

console.log('\n=== Public ledger state (everything an observer can see) ========');
console.log(`  issuerPk               : ${bytesToHex(ledger.issuerPk)}`);
console.log(`  totalCredentialProofs  : ${ledger.totalCredentialProofs}`);
const entries = Array.from(ledger.credentialCommitments) as Array<[bigint, Uint8Array]>;
if (entries.length === 0) console.log('  registry               : empty');
for (const [id, commitment] of entries) {
  const revoked = ledger.revokedCredentials.member(id);
  const expiry = ledger.credentialExpiry.lookup(id) as bigint;
  const verified = ledger.verifiedCredentials.member(id) && ledger.verifiedCredentials.lookup(id);
  console.log(`  credential ${id}`);
  console.log(`    type       : ${ledger.credentialTypes.lookup(id)}`);
  console.log(`    expiry     : ${new Date(Number(expiry) * 1000).toISOString()}`);
  console.log(`    commitment : ${bytesToHex(commitment)} (opaque)`);
  console.log(`    revoked    : ${revoked}`);
  console.log(`    verified   : ${verified}`);
  console.log(`    status     : ${credentialStatus(revoked, expiry, verified, now)}`);
}

const expected = [
  'credentialCommitments',
  'credentialExpiry',
  'credentialTypes',
  'issuerPk',
  'revokedCredentials',
  'totalCredentialProofs',
  'verifiedCredentials',
];
const exposed = Object.keys(ledger).sort();
console.log(`\n  fields exposed : ${exposed.join(', ')}`);
const unexpected = exposed.filter((k) => !expected.includes(k));
if (unexpected.length > 0) {
  console.error(`\n❌ Unexpected public fields: ${unexpected.join(', ')}\n`);
  process.exit(1);
}
console.log('  content / score / holder identity : NOT PRESENT');
console.log('\n=== Verified ===================================================\n');
