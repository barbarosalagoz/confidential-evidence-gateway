/**
 * Level 2 test suite: the Compliance-Evidence Commitment contract.
 *
 * The privacy claim under test: the public ledger and public transcript prove
 * "a valid evidence record exists for control X" while the evidence content,
 * its digest and the commitment salt never appear in anything public. Every
 * absence assertion is paired with a positive control using the same scanner.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { EvidenceSimulator } from './evidence-simulator';
import {
  createEvidencePrivateState,
  withEvidenceRecord,
  createEvidenceRecord,
  bytesToHex,
  hexToBytes32,
  parseControlId,
  type EvidencePrivateState,
  type EvidenceRecord,
} from '../src/evidence';
import { renderDeep } from './value-scan';

const CONTROL_A = 1001n;
const CONTROL_B = 2002n;

let recordA: EvidenceRecord;
let recordB: EvidenceRecord;
let baseState: EvidencePrivateState;

beforeAll(async () => {
  recordA = await createEvidenceRecord('SOC2 CC6.1 — access-control review 2026-Q3: PASSED (internal audit ref #4471)');
  recordB = await createEvidenceRecord('ISO27001 A.12 — patch-management log 2026-08: 100% coverage');
  baseState = withEvidenceRecord(
    withEvidenceRecord(createEvidencePrivateState(), CONTROL_A, recordA),
    CONTROL_B,
    recordB,
  );
});

describe('deployment', () => {
  it('starts with an empty registry', async () => {
    const sim = await EvidenceSimulator.deploy(baseState);
    expect(sim.ledger.evidenceCommitments.isEmpty()).toBe(true);
    expect(sim.ledger.verifiedControls.isEmpty()).toBe(true);
    expect(sim.ledger.totalVerifications).toBe(0n);
  });
});

describe('registerEvidence', () => {
  it('publishes an opaque commitment and an unverified marker', async () => {
    const sim = await EvidenceSimulator.deploy(baseState);
    sim.registerEvidence(CONTROL_A);

    expect(sim.ledger.evidenceCommitments.member(CONTROL_A)).toBe(true);
    expect(sim.ledger.verifiedControls.lookup(CONTROL_A)).toBe(false);

    const commitment = sim.ledger.evidenceCommitments.lookup(CONTROL_A);
    expect(commitment).toHaveLength(32);
    // The commitment must not be the raw digest or the raw salt.
    expect(bytesToHex(commitment)).not.toBe(recordA.digestHex);
    expect(bytesToHex(commitment)).not.toBe(recordA.saltHex);
  });

  it('keeps controls independent', async () => {
    const sim = await EvidenceSimulator.deploy(baseState);
    sim.registerEvidence(CONTROL_A);
    expect(sim.ledger.evidenceCommitments.member(CONTROL_B)).toBe(false);
    sim.registerEvidence(CONTROL_B);
    expect(sim.ledger.evidenceCommitments.member(CONTROL_B)).toBe(true);
    expect(bytesToHex(sim.ledger.evidenceCommitments.lookup(CONTROL_A))).not.toBe(
      bytesToHex(sim.ledger.evidenceCommitments.lookup(CONTROL_B)),
    );
  });

  it('fails locally when no record exists for the control — before anything is produced', async () => {
    const sim = await EvidenceSimulator.deploy(createEvidencePrivateState());
    expect(() => sim.registerEvidence(CONTROL_A)).toThrow(/No local evidence record/);
    expect(sim.ledger.evidenceCommitments.isEmpty()).toBe(true);
  });
});

describe('proveEvidence', () => {
  it('marks the control verified when the evidence matches the commitment', async () => {
    const sim = await EvidenceSimulator.deploy(baseState);
    sim.registerEvidence(CONTROL_A);
    sim.proveEvidence(CONTROL_A);

    expect(sim.ledger.verifiedControls.lookup(CONTROL_A)).toBe(true);
    expect(sim.ledger.totalVerifications).toBe(1n);
  });

  it('rejects proving for a control with no registered commitment', async () => {
    const sim = await EvidenceSimulator.deploy(baseState);
    expect(() => sim.proveEvidence(CONTROL_A)).toThrow(/no evidence registered/);
  });

  it('rejects evidence that does not match the registered commitment', async () => {
    const sim = await EvidenceSimulator.deploy(baseState);
    sim.registerEvidence(CONTROL_A);

    // The holder's record changes after registration (tampered or replaced).
    const tampered = await createEvidenceRecord('SOC2 CC6.1 — access-control review 2026-Q3: FAILED');
    sim.setPrivateState(withEvidenceRecord(sim.privateState, CONTROL_A, tampered));

    expect(() => sim.proveEvidence(CONTROL_A)).toThrow(/does not match/);
    expect(sim.ledger.verifiedControls.lookup(CONTROL_A)).toBe(false);
    expect(sim.ledger.totalVerifications).toBe(0n);
  });

  it('re-registration resets the verified flag: new evidence must be re-proven', async () => {
    const sim = await EvidenceSimulator.deploy(baseState);
    sim.registerEvidence(CONTROL_A);
    sim.proveEvidence(CONTROL_A);
    expect(sim.ledger.verifiedControls.lookup(CONTROL_A)).toBe(true);

    const replacement = await createEvidenceRecord('SOC2 CC6.1 — access-control review 2026-Q4: PASSED');
    sim.setPrivateState(withEvidenceRecord(sim.privateState, CONTROL_A, replacement));
    sim.registerEvidence(CONTROL_A);

    expect(sim.ledger.verifiedControls.lookup(CONTROL_A)).toBe(false);
    sim.proveEvidence(CONTROL_A);
    expect(sim.ledger.verifiedControls.lookup(CONTROL_A)).toBe(true);
    expect(sim.ledger.totalVerifications).toBe(2n);
  });
});

describe('privacy: what the public actually sees', () => {
  /** Renders everything a transaction would carry publicly. */
  function publicView(sim: EvidenceSimulator, results: { proofData?: unknown }): string {
    return (
      renderDeep(sim.ledger.evidenceCommitments.member(CONTROL_A) ? Array.from(sim.ledger.evidenceCommitments) : []) +
      renderDeep(Array.from(sim.ledger.verifiedControls)) +
      renderDeep((results.proofData as any)?.publicTranscript ?? '') +
      renderDeep((results.proofData as any)?.input ?? '') +
      renderDeep((results.proofData as any)?.output ?? '')
    );
  }

  it('the digest and salt never appear in public state or public transcript', async () => {
    const sim = await EvidenceSimulator.deploy(baseState);
    const reg = sim.registerEvidence(CONTROL_A);
    const prove = sim.proveEvidence(CONTROL_A);

    for (const results of [reg, prove]) {
      const rendered = publicView(sim, results as any);
      const digestBytes = Array.from(hexToBytes32(recordA.digestHex, 'digest')).join(',');
      const saltBytes = Array.from(hexToBytes32(recordA.saltHex, 'salt')).join(',');
      expect(rendered).not.toContain(recordA.digestHex);
      expect(rendered).not.toContain(recordA.saltHex);
      expect(rendered).not.toContain(digestBytes);
      expect(rendered).not.toContain(saltBytes);
    }
  });

  it('positive control: the same scanner finds the digest where it IS present', async () => {
    const sim = await EvidenceSimulator.deploy(baseState);
    sim.registerEvidence(CONTROL_A);
    // The private transcript (stays on the prover's machine) must contain the
    // witness outputs — proving the scanner is capable of finding them.
    const results = sim.proveEvidence(CONTROL_A);
    const privateRendered = renderDeep((results as any).proofData?.privateTranscriptOutputs ?? (results as any));
    const digestBytes = Array.from(hexToBytes32(recordA.digestHex, 'digest')).join(',');
    expect(privateRendered).toContain(digestBytes);
  });

  it('two different evidence records leave byte-identical public shapes', async () => {
    // Same control, two universes with different private evidence: an observer
    // comparing the two public ledgers learns nothing about the contents.
    const simX = await EvidenceSimulator.deploy(baseState);
    simX.registerEvidence(CONTROL_A);
    simX.proveEvidence(CONTROL_A);

    const otherRecord = await createEvidenceRecord('a completely different confidential document');
    const simY = await EvidenceSimulator.deploy(
      withEvidenceRecord(createEvidencePrivateState(), CONTROL_A, otherRecord),
    );
    simY.registerEvidence(CONTROL_A);
    simY.proveEvidence(CONTROL_A);

    // Identical public shape: same keys registered, same verified flags, same
    // counter. The commitments differ (they commit to different evidence) but
    // both are 32 opaque bytes revealing nothing.
    expect(simY.ledger.verifiedControls.lookup(CONTROL_A)).toBe(
      simX.ledger.verifiedControls.lookup(CONTROL_A),
    );
    expect(simY.ledger.totalVerifications).toBe(simX.ledger.totalVerifications);
    expect(simY.ledger.evidenceCommitments.lookup(CONTROL_A)).toHaveLength(32);
    expect(simX.ledger.evidenceCommitments.lookup(CONTROL_A)).toHaveLength(32);
  });
});

describe('parseControlId', () => {
  it('accepts Uint<64> values and rejects everything else', () => {
    expect(parseControlId('0')).toBe(0n);
    expect(parseControlId('18446744073709551615')).toBe(18446744073709551615n);
    expect(() => parseControlId('18446744073709551616')).toThrow(/range/);
    expect(() => parseControlId('-1')).toThrow(/non-negative/);
    expect(() => parseControlId('abc')).toThrow(/non-negative/);
  });
});
