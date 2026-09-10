/**
 * Level 3 test suite: Confidential Compliance Credentials.
 *
 * Required by the Level 3 brief: issue, prove-valid, prove-fails-after-revoke,
 * prove-fails-after-expiry. Plus: issuer authority, holder binding, content
 * integrity, and the privacy scan — what an observer sees and does not see.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CredentialsSimulator, loadCredentialsModule } from './credentials-simulator';
import {
  createCredentialPrivateState,
  createCredentialRecord,
  withCredentialRecord,
  generateSecretKeyHex,
  credentialStatus,
  isoToEpochSeconds,
  bytesToHex,
  hexToBytes32,
  HOLDER_DOMAIN,
  type CredentialPrivateState,
  type CredentialRecord,
} from '../src/credentials';
import { renderDeep } from './value-scan';

const CRED = 7001n;
const TYPE_SOC2 = 1n;
const NOW = 1_800_000_000; // simulated block time, seconds
const EXPIRY = BigInt(NOW + 90 * 24 * 3600); // 90 days out

let issuerSk: string;
let holderSk: string;
let strangerSk: string;
let holderPkHex: string;
/** Holder-side material: content digest + salt (received from the issuer out-of-band). */
let record: CredentialRecord;
/** Issuer-side material: the same, plus the holder's public key for the commitment. */
let issuerRecord: CredentialRecord;
/** Issuer's machine: issuer key + issuer-side material. */
let issuerState: CredentialPrivateState;
/** Holder's machine: holder key + holder-side material. */
let holderState: CredentialPrivateState;

beforeAll(async () => {
  const module = await loadCredentialsModule();
  issuerSk = generateSecretKeyHex();
  holderSk = generateSecretKeyHex();
  strangerSk = generateSecretKeyHex();
  holderPkHex = bytesToHex(module.pureCircuits.derivePk(hexToBytes32(holderSk, 'sk'), HOLDER_DOMAIN));
  record = await createCredentialRecord('SOC2 Type II — audit 2026-Q3 — composite score 92/100 — CONFIDENTIAL');
  issuerRecord = { ...record, holderPkHex };
  issuerState = withCredentialRecord(createCredentialPrivateState({ issuerSecretKeyHex: issuerSk }), CRED, issuerRecord);
  holderState = withCredentialRecord(createCredentialPrivateState({ holderSecretKeyHex: holderSk }), CRED, record);
});

/** Deploys as the issuer and issues CRED to the holder. */
async function issued(): Promise<CredentialsSimulator> {
  const sim = await CredentialsSimulator.deploy(issuerState, NOW);
  sim.issueCredential(CRED, TYPE_SOC2, EXPIRY);
  return sim;
}

describe('issue', () => {
  it('publishes commitment, type and expiry; verified=false; holder pk stays private', async () => {
    const sim = await issued();
    const l = sim.ledger;
    expect(l.credentialCommitments.member(CRED)).toBe(true);
    expect(l.credentialCommitments.lookup(CRED)).toHaveLength(32);
    expect(l.credentialTypes.lookup(CRED)).toBe(TYPE_SOC2);
    expect(l.credentialExpiry.lookup(CRED)).toBe(EXPIRY);
    expect(l.verifiedCredentials.lookup(CRED)).toBe(false);
    expect(l.revokedCredentials.member(CRED)).toBe(false);
    // The holder's public key is inside the commitment, not on the ledger.
    expect(renderDeep(Array.from(l.credentialCommitments))).not.toContain(holderPkHex);
    expect(bytesToHex(l.credentialCommitments.lookup(CRED))).not.toBe(holderPkHex);
  });

  it('rejects a second issuance under the same id', async () => {
    const sim = await issued();
    expect(() => sim.issueCredential(CRED, TYPE_SOC2, EXPIRY)).toThrow(/already issued/);
  });

  it('rejects a non-issuer (wrong key) and a machine with no issuer key at all', async () => {
    const sim = await CredentialsSimulator.deploy(issuerState, NOW);
    const impostor = withCredentialRecord(
      createCredentialPrivateState({ issuerSecretKeyHex: strangerSk }),
      CRED,
      issuerRecord,
    );
    sim.setPrivateState(impostor);
    expect(() => sim.issueCredential(CRED, TYPE_SOC2, EXPIRY)).toThrow(/not the issuer/);
    sim.setPrivateState(holderState); // holder has no issuer key
    expect(() => sim.issueCredential(CRED, TYPE_SOC2, EXPIRY)).toThrow(/No local issuer secret key/);
    expect(sim.ledger.credentialCommitments.isEmpty()).toBe(true);
  });
});

describe('prove-valid', () => {
  it('the holder proves a live credential: verified=true, counter=1', async () => {
    const sim = await issued();
    sim.setPrivateState(holderState);
    sim.proveCredential(CRED);
    expect(sim.ledger.verifiedCredentials.lookup(CRED)).toBe(true);
    expect(sim.ledger.totalCredentialProofs).toBe(1n);
  });

  it('proving still works right up to the last second before expiry', async () => {
    const sim = await issued();
    sim.setPrivateState(holderState);
    sim.setBlockTime(Number(EXPIRY) - 1);
    sim.proveCredential(CRED);
    expect(sim.ledger.verifiedCredentials.lookup(CRED)).toBe(true);
  });
});

describe('prove-fails', () => {
  it('after revocation', async () => {
    const sim = await issued();
    sim.setPrivateState(holderState);
    sim.proveCredential(CRED);
    expect(sim.ledger.verifiedCredentials.lookup(CRED)).toBe(true);

    sim.setPrivateState(issuerState);
    sim.revokeCredential(CRED);
    expect(sim.ledger.revokedCredentials.member(CRED)).toBe(true);
    expect(sim.ledger.verifiedCredentials.lookup(CRED)).toBe(false); // revocation resets the flag

    sim.setPrivateState(holderState);
    expect(() => sim.proveCredential(CRED)).toThrow(/revoked/);
    expect(sim.ledger.totalCredentialProofs).toBe(1n);
  });

  it('after expiry, judged by block time (at expiry and beyond)', async () => {
    const sim = await issued();
    sim.setPrivateState(holderState);
    sim.setBlockTime(Number(EXPIRY)); // block time == expiry → no longer strictly before
    expect(() => sim.proveCredential(CRED)).toThrow(/expired/);
    sim.setBlockTime(Number(EXPIRY) + 3600);
    expect(() => sim.proveCredential(CRED)).toThrow(/expired/);
    expect(sim.ledger.verifiedCredentials.lookup(CRED)).toBe(false);
  });

  it('for someone who knows the content but is not the holder', async () => {
    const sim = await issued();
    const stranger = withCredentialRecord(
      createCredentialPrivateState({ holderSecretKeyHex: strangerSk }),
      CRED,
      record,
    );
    sim.setPrivateState(stranger);
    expect(() => sim.proveCredential(CRED)).toThrow(/not the holder/);
  });

  it('for the holder with altered content (integrity)', async () => {
    const sim = await issued();
    const tampered = await createCredentialRecord('SOC2 Type II — audit 2026-Q3 — composite score 99/100');
    sim.setPrivateState(withCredentialRecord(holderState, CRED, tampered));
    expect(() => sim.proveCredential(CRED)).toThrow(/not the holder/);
  });

  it('for an unknown credential id', async () => {
    const sim = await issued();
    sim.setPrivateState(holderState);
    expect(() => sim.proveCredential(9999n)).toThrow(/unknown credential/);
  });

  it('revocation by a non-issuer is rejected', async () => {
    const sim = await issued();
    sim.setPrivateState(holderState);
    expect(() => sim.revokeCredential(CRED)).toThrow(/No local issuer secret key/);
    expect(sim.ledger.revokedCredentials.member(CRED)).toBe(false);
  });
});

describe('privacy: what the public sees', () => {
  function publicView(sim: CredentialsSimulator, results: { proofData?: unknown }): string {
    const l = sim.ledger;
    return (
      renderDeep(Array.from(l.credentialCommitments)) +
      renderDeep(Array.from(l.credentialTypes)) +
      renderDeep(Array.from(l.credentialExpiry)) +
      renderDeep(Array.from(l.verifiedCredentials)) +
      renderDeep((results.proofData as any)?.publicTranscript ?? '') +
      renderDeep((results.proofData as any)?.input ?? '') +
      renderDeep((results.proofData as any)?.output ?? '')
    );
  }

  it('digest, salt, holder pk and both secret keys never appear publicly', async () => {
    const sim = await CredentialsSimulator.deploy(issuerState, NOW);
    const issue = sim.issueCredential(CRED, TYPE_SOC2, EXPIRY);
    sim.setPrivateState(holderState);
    const prove = sim.proveCredential(CRED);

    const secrets = {
      digest: record.digestHex,
      salt: record.saltHex,
      holderPk: holderPkHex,
      holderSk,
      issuerSk,
    };
    for (const results of [issue, prove]) {
      const rendered = publicView(sim, results as any);
      for (const [name, hex] of Object.entries(secrets)) {
        expect(rendered, `${name} leaked`).not.toContain(hex);
        expect(rendered, `${name} leaked as bytes`).not.toContain(Array.from(hexToBytes32(hex, name)).join(','));
      }
    }
  });

  it('positive control: the private transcript does contain the digest', async () => {
    const sim = await issued();
    sim.setPrivateState(holderState);
    const results = sim.proveCredential(CRED);
    const privateRendered = renderDeep((results as any).proofData?.privateTranscriptOutputs ?? results);
    expect(privateRendered).toContain(Array.from(hexToBytes32(record.digestHex, 'digest')).join(','));
  });

  it('type and expiry ARE public — by design, so the policy is auditable', async () => {
    const sim = await issued();
    expect(sim.ledger.credentialTypes.lookup(CRED)).toBe(TYPE_SOC2);
    expect(sim.ledger.credentialExpiry.lookup(CRED)).toBe(EXPIRY);
  });
});

describe('verifier helpers', () => {
  it('credentialStatus ranks revoked > expired > valid/unproven', () => {
    expect(credentialStatus(true, 10n, true, 5n)).toBe('revoked');
    expect(credentialStatus(false, 10n, true, 10n)).toBe('expired');
    expect(credentialStatus(false, 10n, true, 9n)).toBe('valid');
    expect(credentialStatus(false, 10n, false, 9n)).toBe('unproven');
  });

  it('isoToEpochSeconds matches block-time units', () => {
    expect(isoToEpochSeconds('1970-01-01T00:01:00Z')).toBe(60n);
    expect(() => isoToEpochSeconds('not a date')).toThrow(/Invalid date/);
  });
});
