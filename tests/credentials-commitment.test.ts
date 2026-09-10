/**
 * Cross-implementation pin: the CLI (issuer), the web holder path, the
 * off-chain commitment helper and the circuit must all agree, byte for byte,
 * on the commitment for a credential — anchored to a real Preprod issuance.
 *
 * Credential 7003 on Preprod (contract 0fed435f…bcce, tx 480f103f…, block
 * 2493825): content "score 92/100", the holder's public key and salt below.
 */
import { describe, it, expect } from 'vitest';
import { CredentialsSimulator } from './credentials-simulator';
import {
  createCredentialPrivateState,
  createCredentialRecord,
  createCredentialRecordFromMaterial,
  credentialCommitmentHex,
  contentDigestHex,
  generateSecretKeyHex,
  withCredentialRecord,
  HOLDER_DOMAIN,
  hexToBytes32,
  bytesToHex,
} from '../src/credentials';

const PREPROD_7003 = {
  content: 'score 92/100',
  holderPkHex: 'd16b3c30b7f57d25c77036a3aacfc3ce4d6cd0d12604cdd5f104307fb98366f7',
  saltHex: '97cb02cb57f6c4bd3b261166bbbf3800c9c156a4331b55b71a6ab342776d9ea1',
  onChainCommitmentHex: '298ec8b09df0c76e452d6690268de255acd1fc77f606bba86f9a0f49eb53e181',
  digestHex: '3503f9dcfe4b7d95',
};

describe('credential commitment — cross-implementation pin (Preprod 7003)', () => {
  it('the off-chain helper reproduces the on-chain commitment', async () => {
    const digest = await contentDigestHex(PREPROD_7003.content);
    expect(digest.startsWith(PREPROD_7003.digestHex)).toBe(true);
    expect(credentialCommitmentHex(digest, PREPROD_7003.holderPkHex, PREPROD_7003.saltHex)).toBe(
      PREPROD_7003.onChainCommitmentHex,
    );
  });

  it('the circuit (issuer path) reproduces the on-chain commitment from the same material', async () => {
    const issuerSk = generateSecretKeyHex();
    const record = { ...(await createCredentialRecordFromMaterial(PREPROD_7003.content, PREPROD_7003.saltHex)), holderPkHex: PREPROD_7003.holderPkHex };
    const sim = await CredentialsSimulator.deploy(
      withCredentialRecord(createCredentialPrivateState({ issuerSecretKeyHex: issuerSk }), 7003n, record),
    );
    sim.issueCredential(7003n, 1n, 1806710400n);
    expect(bytesToHex(sim.ledger.credentialCommitments.lookup(7003n))).toBe(PREPROD_7003.onChainCommitmentHex);
  });

  it('the holder path (web import) builds the identical record from content + salt', async () => {
    const holderSide = await createCredentialRecordFromMaterial(PREPROD_7003.content, PREPROD_7003.saltHex);
    expect(credentialCommitmentHex(holderSide.digestHex, PREPROD_7003.holderPkHex, holderSide.saltHex)).toBe(
      PREPROD_7003.onChainCommitmentHex,
    );
  });

  it('a pasted trailing newline / surrounding whitespace no longer changes the commitment', async () => {
    for (const messy of ['score 92/100\n', 'score 92/100\r\n', '  score 92/100 ', '\tscore 92/100']) {
      const r = await createCredentialRecordFromMaterial(messy, PREPROD_7003.saltHex.toUpperCase());
      expect(r.content).toBe('score 92/100');
      expect(credentialCommitmentHex(r.digestHex, PREPROD_7003.holderPkHex, r.saltHex)).toBe(PREPROD_7003.onChainCommitmentHex);
    }
    // Internal whitespace is content and MUST change the digest.
    const r = await createCredentialRecordFromMaterial('score  92/100', PREPROD_7003.saltHex);
    expect(credentialCommitmentHex(r.digestHex, PREPROD_7003.holderPkHex, r.saltHex)).not.toBe(PREPROD_7003.onChainCommitmentHex);
  });

  it('holder proof uses the same pk derivation the panel displays: derivePk(sk, pad(32,"cred:holder"))', async () => {
    const holderSk = generateSecretKeyHex();
    const sim = await CredentialsSimulator.deploy(createCredentialPrivateState({ issuerSecretKeyHex: generateSecretKeyHex() }));
    const panelPk = bytesToHex(sim.derivePk(hexToBytes32(holderSk, 'sk'), HOLDER_DOMAIN));
    expect(bytesToHex(HOLDER_DOMAIN)).toBe('637265643a686f6c646572' + '00'.repeat(21));

    const record = { ...(await createCredentialRecord('any content')), holderPkHex: panelPk };
    sim.setPrivateState(withCredentialRecord(sim.privateState, 9001n, record));
    sim.issueCredential(9001n, 1n, 4102444800n);
    // Proving as the holder recomputes the pk in-circuit from the secret key;
    // it must equal the panel's pk or the commitment check fails.
    sim.setPrivateState(withCredentialRecord(createCredentialPrivateState({ holderSecretKeyHex: holderSk }), 9001n, record));
    sim.proveCredential(9001n);
    expect(sim.ledger.verifiedCredentials.lookup(9001n)).toBe(true);
    expect(credentialCommitmentHex(record.digestHex, panelPk, record.saltHex)).toBe(
      bytesToHex(sim.ledger.credentialCommitments.lookup(9001n)),
    );
  });
});
