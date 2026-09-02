/**
 * Verifies the deployed evidence registry from the chain alone — no wallet,
 * no sync. This is the observer's view: it prints which controls have
 * commitments and which are verified, and demonstrates that the evidence
 * contents are nowhere in public state.
 *
 * Address resolution order: --address flag, then deployments/evidence.<network>.json.
 */
import '../src/env';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { resolveNetwork } from '../src/network';
import { loadEvidenceContract } from '../src/evidence-node';
import { bytesToHex } from '../src/evidence';

const { network, config } = resolveNetwork();
setNetworkId(config.networkId);

function resolveAddress(): string | null {
  const idx = process.argv.indexOf('--address');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const p = path.resolve(moduleDir, '..', 'deployments', `evidence.${network}.json`);
  if (fs.existsSync(p)) {
    return (JSON.parse(fs.readFileSync(p, 'utf-8')) as { contractAddress?: string }).contractAddress ?? null;
  }
  return null;
}

const address = resolveAddress();
if (!address) {
  console.error(
    `\nNo evidence deployment on file for ${network}. Run: npm run deploy:evidence -- --network ${network}\n`,
  );
  process.exit(1);
}

const query = `{
  contractAction(address: "${address}") {
    __typename
    address
    state
    transaction { hash block { height timestamp } }
  }
}`;

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

const { module: EvidenceContract } = await loadEvidenceContract();
const contractState = ContractState.deserialize(Uint8Array.from(Buffer.from(action.state, 'hex')));
const ledger = EvidenceContract.ledger(contractState.data);

const block = action.transaction?.block ?? {};
console.log('\n=== Latest on-chain action =====================================');
console.log(`  network        : ${network}`);
console.log(`  contract       : ${action.address}`);
console.log(`  action type    : ${action.__typename}`);
console.log(`  tx hash        : ${action.transaction?.hash}`);
console.log(`  block height   : ${block.height}`);
console.log(`  block time     : ${block.timestamp ? new Date(block.timestamp).toISOString() : 'n/a'}`);

console.log('\n=== Public ledger state (everything an observer can see) ========');
console.log(`  totalVerifications : ${ledger.totalVerifications}`);
const entries = Array.from(ledger.evidenceCommitments) as Array<[bigint, Uint8Array]>;
if (entries.length === 0) {
  console.log('  registry           : empty');
} else {
  for (const [controlId, commitment] of entries) {
    const verified = ledger.verifiedControls.member(controlId) && ledger.verifiedControls.lookup(controlId);
    console.log(`  control ${controlId}`);
    console.log(`    commitment : ${bytesToHex(commitment)} (opaque)`);
    console.log(`    verified   : ${verified ? '✓ proven' : '— registered, unproven'}`);
  }
}

const exposed = Object.keys(ledger).sort();
console.log(`\n  fields exposed     : ${exposed.join(', ')}`);
const expected = ['evidenceCommitments', 'totalVerifications', 'verifiedControls'];
const unexpected = exposed.filter((k) => !expected.includes(k));
if (unexpected.length > 0) {
  console.error(`\n❌ Unexpected public fields: ${unexpected.join(', ')}\n`);
  process.exit(1);
}
console.log('  evidence contents  : NOT PRESENT — only commitments and verified flags are public');
console.log('\n=== Verified ===================================================\n');
