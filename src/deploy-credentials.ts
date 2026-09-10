/**
 * Deploy the Confidential Compliance Credentials contract (Level 3).
 *
 *   npm run deploy:credentials -- --network preprod
 *
 * The deployer becomes the ISSUER: a fresh issuer secret key is generated
 * (or reused from .credentials-issuer.<network>.key), its public key is
 * derived off-chain with the contract's own pureCircuits.derivePk, and that
 * public key is the single constructor argument. The secret key never leaves
 * this machine; it is written to the git-ignored key file so the web Issuer
 * panel can import it for the demo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';

import { bootstrapWallet, makeProviders, waitForProofServer, settleDust, isDustShortage } from './node-runtime';
import { loadCredentialsContract, isCredentialsCompiled, credentialsZkConfigPath } from './credentials-node';
import {
  createCredentialPrivateState,
  generateSecretKeyHex,
  hexToBytes32,
  bytesToHex,
  ISSUER_DOMAIN,
  CREDENTIAL_PRIVATE_STATE_ID,
  CREDENTIAL_PRIVATE_STATE_STORE_NAME,
} from './credentials';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..');

if (!isCredentialsCompiled()) {
  console.error('\n❌ Contract not compiled! Run: npm run compile:credentials\n');
  process.exit(1);
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Deploy Confidential Compliance Credentials');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const boot = await bootstrapWallet();
  const { network, networkConfig, walletCtx } = boot;

  const keyPath = path.join(repoRoot, `.credentials-issuer.${network}.key`);
  let issuerSkHex: string;
  if (fs.existsSync(keyPath)) {
    issuerSkHex = fs.readFileSync(keyPath, 'utf-8').trim();
    console.log(`  Reusing issuer key from ${path.basename(keyPath)}`);
  } else {
    issuerSkHex = generateSecretKeyHex();
    fs.writeFileSync(keyPath, `${issuerSkHex}\n`, { mode: 0o600 });
    console.log(`  New issuer key written to ${path.basename(keyPath)} (git-ignored; back it up).`);
  }

  const { module, compiledContract } = await loadCredentialsContract();
  const issuerPk: Uint8Array = module.pureCircuits.derivePk(hexToBytes32(issuerSkHex, 'issuer key'), ISSUER_DOMAIN);
  console.log(`  Issuer public key (goes on-chain): ${bytesToHex(issuerPk)}\n`);

  if (!(await waitForProofServer(networkConfig.proofServer))) {
    console.log('  ❌ Proof server not responding. Run: docker compose up -d proof-server\n');
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  const providers = makeProviders(boot, credentialsZkConfigPath, CREDENTIAL_PRIVATE_STATE_STORE_NAME);
  await settleDust();
  console.log('  Deploying...');

  let deployed: Awaited<ReturnType<typeof deployContract>> | undefined;
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      deployed = await deployContract(providers, {
        compiledContract: compiledContract as any,
        args: [issuerPk],
        privateStateId: CREDENTIAL_PRIVATE_STATE_ID,
        initialPrivateState: createCredentialPrivateState({ issuerSecretKeyHex: issuerSkHex }),
      });
      break;
    } catch (err) {
      if (!isDustShortage(err) || attempt === 20) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (!deployed) throw new Error('Deployment failed');

  const contractAddress = deployed.deployTxData.public.contractAddress;
  const pub = deployed.deployTxData.public as any;
  console.log('\n  ✅ Deployed');
  console.log(`  Contract: ${contractAddress}`);
  console.log(`  Deploy tx: ${pub.txId ?? pub.txHash} (block ${pub.blockHeight})\n`);

  const outDir = path.join(repoRoot, 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `credentials.${network}.json`);
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        network,
        contractAddress,
        issuerPublicKey: bytesToHex(issuerPk),
        deployTxId: `${pub.txId ?? pub.txHash ?? ''}`,
        blockHeight: `${pub.blockHeight ?? ''}`,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  Recorded in ${path.relative(process.cwd(), outPath)} — commit this file.\n`);
  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
