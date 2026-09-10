/**
 * Issuer/holder CLI for the deployed credentials registry.
 *
 *   npm run credentials -- --network preprod issue  --credential 7001 --type 1 --expiry 2027-03-31 --content "..."
 *   npm run credentials -- --network preprod prove  --credential 7001
 *   npm run credentials -- --network preprod revoke --credential 7001
 *
 * This machine plays both roles for the demo: the issuer key comes from the
 * deploy's key file; a holder key is generated on first use. Real deployments
 * would split these across two machines and hand over (content, salt)
 * out-of-band.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import { bootstrapWallet, makeProviders, waitForProofServer, settleDust } from '../src/node-runtime';
import { loadCredentialsContract, credentialsZkConfigPath } from '../src/credentials-node';
import {
  createCredentialPrivateState,
  createCredentialRecord,
  withCredentialRecord,
  generateSecretKeyHex,
  hexToBytes32,
  bytesToHex,
  parseUint64,
  isoToEpochSeconds,
  HOLDER_DOMAIN,
  CREDENTIAL_PRIVATE_STATE_ID,
  CREDENTIAL_PRIVATE_STATE_STORE_NAME,
  type CredentialPrivateState,
} from '../src/credentials';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..');

function arg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}
const action = process.argv.slice(2).find((a) => ['issue', 'prove', 'revoke'].includes(a));
if (!action) {
  console.error('Usage: credentials-cli <issue|prove|revoke> --credential <id> [--type <id>] [--expiry <ISO date>] [--content "..."]');
  process.exit(1);
}
const credentialId = parseUint64(arg('--credential') ?? '7001', 'credential id');

async function main() {
  const boot = await bootstrapWallet();
  const { network, networkConfig, walletCtx } = boot;

  const deploymentPath = path.join(repoRoot, 'deployments', `credentials.${network}.json`);
  if (!fs.existsSync(deploymentPath)) throw new Error(`No deployment at ${deploymentPath}`);
  const { contractAddress } = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8')) as { contractAddress: string };

  if (!(await waitForProofServer(networkConfig.proofServer))) throw new Error('Proof server not responding.');
  const providers = makeProviders(boot, credentialsZkConfigPath, CREDENTIAL_PRIVATE_STATE_STORE_NAME);
  const { module, compiledContract } = await loadCredentialsContract();

  // findDeployedContract WRITES initialPrivateState to the store on every
  // join, so the existing state must be read first and passed back in —
  // otherwise a second run wipes the holder key and credential material.
  providers.privateStateProvider.setContractAddress(contractAddress);
  let state =
    ((await providers.privateStateProvider.get(CREDENTIAL_PRIVATE_STATE_ID)) as CredentialPrivateState | null) ??
    createCredentialPrivateState();

  const deployed = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: compiledContract as any,
    privateStateId: CREDENTIAL_PRIVATE_STATE_ID,
    initialPrivateState: state,
  });
  providers.privateStateProvider.setContractAddress(contractAddress);

  const keyPath = path.join(repoRoot, `.credentials-issuer.${network}.key`);
  if (fs.existsSync(keyPath)) state = { ...state, issuerSecretKeyHex: fs.readFileSync(keyPath, 'utf-8').trim() };
  if (!state.holderSecretKeyHex) {
    state = { ...state, holderSecretKeyHex: generateSecretKeyHex() };
    console.log('  Generated a holder secret key for this machine (kept in the private-state store).');
  }

  if (action === 'issue') {
    const typeId = parseUint64(arg('--type') ?? '1', 'type id');
    const expiry = isoToEpochSeconds(arg('--expiry') ?? new Date(Date.now() + 90 * 86400_000).toISOString());
    const content = arg('--content') ?? `SOC2 Type II — audit ${new Date().toISOString().slice(0, 10)} — score 92/100 — CONFIDENTIAL`;
    // --holder-pk: issue to an external holder (e.g. a browser/Lace holder's
    // public key). Without it this machine's own holder key is used.
    const externalHolderPk = arg('--holder-pk');
    const holderPkHex = externalHolderPk
      ? bytesToHex(hexToBytes32(externalHolderPk.trim(), 'holder public key'))
      : bytesToHex(module.pureCircuits.derivePk(hexToBytes32(state.holderSecretKeyHex!, 'holder key'), HOLDER_DOMAIN));
    const record = { ...(await createCredentialRecord(content)), holderPkHex };
    state = withCredentialRecord(state, credentialId, record);
    await providers.privateStateProvider.set(CREDENTIAL_PRIVATE_STATE_ID, state);
    console.log(`  Local material stored for credential ${credentialId} (holder pk ${holderPkHex.slice(0, 16)}…).`);
    await settleDust();
    console.log('  Calling issueCredential()...');
    const tx = await (deployed as any).callTx.issueCredential(credentialId, typeId, expiry);
    console.log(`  ✓ issueCredential tx ${tx.public.txHash} (block ${tx.public.blockHeight})`);
    if (externalHolderPk) {
      // The holder needs exactly these two values to store material and prove.
      console.log('\n  ─── Hand-over to the holder (out-of-band; PRIVATE) ───');
      console.log(`  credential id : ${credentialId}`);
      console.log(`  content       : ${content}`);
      console.log(`  salt          : ${record.saltHex}`);
    }
  } else {
    await providers.privateStateProvider.set(CREDENTIAL_PRIVATE_STATE_ID, state);
    await settleDust();
    if (action === 'prove') {
      console.log('  Calling proveCredential()...');
      const tx = await (deployed as any).callTx.proveCredential(credentialId);
      console.log(`  ✓ proveCredential tx ${tx.public.txHash} (block ${tx.public.blockHeight})`);
    } else {
      console.log('  Calling revokeCredential()...');
      const tx = await (deployed as any).callTx.revokeCredential(credentialId);
      console.log(`  ✓ revokeCredential tx ${tx.public.txHash} (block ${tx.public.blockHeight})`);
    }
  }
  console.log(`\n  Observer view: npm run verify:credentials -- --network ${network}\n`);
  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
