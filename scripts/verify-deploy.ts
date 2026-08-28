/**
 * Verifies the deployed contract from the chain alone — no wallet, no sync.
 *
 * Queries the indexer for the contract's published state and decodes it with
 * the generated `ledger()` reader, so the output is exactly what any observer
 * can see. Used as deployment evidence: it shows the policy threshold and the
 * verified-claim count, and asserts that nothing else is exposed.
 */
import '../src/env';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { resolveNetwork, getDeployment } from '../src/network';
import { loadCompiledContract } from '../src/compiled-contract';

const { network, config } = resolveNetwork();
setNetworkId(config.networkId);

const deployment = getDeployment(network);
if (!deployment) {
  console.error(`\nNo deployment on file for ${network}. Run: npm run setup -- --network ${network}\n`);
  process.exit(1);
}

const query = `{
  contractAction(address: "${deployment.address}") {
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
  console.error(`\n❌ Indexer has no contract at ${deployment.address} on ${network}.\n`);
  process.exit(1);
}

const { module: ComplianceContract } = await loadCompiledContract();
const contractState = ContractState.deserialize(Uint8Array.from(Buffer.from(action.state, 'hex')));
const ledger = ComplianceContract.ledger(contractState.data);

const block = action.transaction?.block ?? {};
// contractAction(address) returns the contract's MOST RECENT action, not its
// deployment — after the first circuit call this is a ContractCall, not the
// ContractDeploy. Label it accurately rather than implying it is the deploy.
console.log('\n=== Latest on-chain action =====================================');
console.log(`  network        : ${network}`);
console.log(`  contract       : ${action.address}`);
console.log(`  action type    : ${action.__typename}`);
console.log(`  tx hash        : ${action.transaction?.hash}`);
console.log(`  block height   : ${block.height}`);
console.log(`  block time     : ${block.timestamp ? new Date(block.timestamp).toISOString() : 'n/a'}`);

console.log('\n=== Public ledger state (everything an observer can see) ========');
console.log(`  publicMinimumScore : ${ledger.publicMinimumScore}`);
console.log(`  verifiedClaims     : ${ledger.verifiedClaims}`);

const exposed = Object.keys(ledger).sort();
console.log(`\n  fields exposed     : ${exposed.join(', ')}`);
const expected = ['publicMinimumScore', 'verifiedClaims'];
const unexpected = exposed.filter((k) => !expected.includes(k));
if (unexpected.length > 0) {
  console.error(`\n❌ Unexpected public fields: ${unexpected.join(', ')}\n`);
  process.exit(1);
}
console.log('  supplier score     : NOT PRESENT — the private witness is not in public state');
console.log('\n=== Verified ===================================================\n');
