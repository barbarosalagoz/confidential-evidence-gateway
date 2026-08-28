import { describe, it, expect } from 'vitest';
import { ComplianceSimulator } from './simulator';
import { containsValue, renderDeep } from './value-scan';
import { parseMinimumScore, createCompliancePrivateState, witnesses } from '../src/compliance';

/**
 * A deliberately distinctive private score. Using a large, unusual value means
 * that if the privacy scan finds it in public data, that is a real leak and
 * not a coincidental byte pattern.
 */
const PRIVATE_SCORE = 1234567890123n;
const THRESHOLD = 70n;

describe('circuit logic: private score vs public threshold', () => {
  it('produces a proof when the private score exceeds the threshold', async () => {
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);

    expect(() => sim.proveCompliance()).not.toThrow();
    expect(sim.ledger.verifiedClaims).toBe(1n);
  });

  it('produces a proof at the boundary, where score equals the threshold', async () => {
    // The circuit asserts `>=`, so equality must be accepted. This is the
    // case a `>` typo would silently break.
    const sim = await ComplianceSimulator.deploy(THRESHOLD, THRESHOLD);

    expect(() => sim.proveCompliance()).not.toThrow();
    expect(sim.ledger.verifiedClaims).toBe(1n);
  });

  it('cannot produce a proof when the private score is below the threshold', async () => {
    const sim = await ComplianceSimulator.deploy(THRESHOLD - 1n, THRESHOLD);

    expect(() => sim.proveCompliance()).toThrow();
  });

  it('leaves public state untouched when the claim fails', async () => {
    const sim = await ComplianceSimulator.deploy(1n, THRESHOLD);

    expect(() => sim.proveCompliance()).toThrow();

    // A failed claim is indistinguishable from never having tried: the
    // counter does not move, so an observer cannot count failed attempts.
    expect(sim.ledger.verifiedClaims).toBe(0n);
    expect(sim.ledger.publicMinimumScore).toBe(THRESHOLD);
  });
});

describe('state transition: verifiedClaims', () => {
  it('starts at zero and records the disclosed threshold', async () => {
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);

    expect(sim.ledger.verifiedClaims).toBe(0n);
    // The constructor's disclose(minimumScore) — the one deliberate
    // disclosure in the contract.
    expect(sim.ledger.publicMinimumScore).toBe(THRESHOLD);
  });

  it('increments exactly once per verified claim', async () => {
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);

    expect(sim.ledger.verifiedClaims).toBe(0n);
    sim.proveCompliance();
    expect(sim.ledger.verifiedClaims).toBe(1n);
    sim.proveCompliance();
    expect(sim.ledger.verifiedClaims).toBe(2n);
    sim.proveCompliance();
    expect(sim.ledger.verifiedClaims).toBe(3n);
  });

  it('never mutates the policy threshold', async () => {
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);

    sim.proveCompliance();
    sim.proveCompliance();

    expect(sim.ledger.publicMinimumScore).toBe(THRESHOLD);
  });

  it('does not alter the supplier private state', async () => {
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);

    sim.proveCompliance();

    expect(sim.privateState.complianceScore).toBe(PRIVATE_SCORE);
  });
});

describe('privacy: the private score must not reach public data', () => {
  it('is absent from the public ledger state after a successful claim', async () => {
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);
    sim.proveCompliance();

    const ledger = sim.ledger;

    // The entire public surface is two fields, and neither is the score.
    expect(Object.keys(ledger).sort()).toEqual(['publicMinimumScore', 'verifiedClaims']);
    expect(ledger.publicMinimumScore).toBe(THRESHOLD);
    expect(ledger.verifiedClaims).toBe(1n);
    expect(containsValue(ledger, PRIVATE_SCORE)).toBe(false);
  });

  it('is absent from the public transcript sent on-chain', async () => {
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);
    const { proofData } = sim.proveCompliance();

    // publicTranscript is the part of the proof that is published in the
    // transaction. This is the assertion that matters most.
    expect(containsValue(proofData.publicTranscript, PRIVATE_SCORE)).toBe(false);
    expect(containsValue(proofData.input, PRIVATE_SCORE)).toBe(false);
    expect(containsValue(proofData.output, PRIVATE_SCORE)).toBe(false);
    expect(renderDeep(proofData.publicTranscript)).not.toContain(PRIVATE_SCORE.toString());
  });

  it('is absent from the whole circuit context an observer could reconstruct', async () => {
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);
    sim.proveCompliance();

    expect(containsValue(sim.circuitContext.currentQueryContext, PRIVATE_SCORE)).toBe(false);
  });

  it('positive control: the scanner does find the score in the private transcript', async () => {
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);
    const { proofData } = sim.proveCompliance();

    // Without this, every assertion above could pass simply because the
    // scanner cannot see anything. The private transcript stays on the
    // prover's machine — it is the input to proof generation, not output.
    expect(containsValue(proofData.privateTranscriptOutputs, PRIVATE_SCORE)).toBe(true);
  });

  it('positive control: the scanner does find the public threshold in public data', async () => {
    // A second control, this time on the public side: a value that IS
    // disclosed is visible exactly where we expect it.
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);
    sim.proveCompliance();

    expect(containsValue(sim.ledger, THRESHOLD)).toBe(true);
  });

  it('positive control: the scanner can read the public transcript it clears', async () => {
    // The sharpest control of the three. The absence assertion above is only
    // meaningful if the scanner can see into `publicTranscript` at all — so
    // here the SAME scanner, on the SAME structure, must find the threshold,
    // which the circuit genuinely reads in public. It does: the transcript
    // carries a `popeq` op whose result is the 8-byte encoding of 70. The
    // private score is nowhere in those same six ops.
    const sim = await ComplianceSimulator.deploy(PRIVATE_SCORE, THRESHOLD);
    const { proofData } = sim.proveCompliance();

    expect(containsValue(proofData.publicTranscript, THRESHOLD)).toBe(true);
    expect(containsValue(proofData.publicTranscript, PRIVATE_SCORE)).toBe(false);
  });

  it('two suppliers with different scores produce identical public state', async () => {
    // The strongest statement of the privacy property: public state is a
    // function of the policy and the claim count only. Nothing an observer
    // sees distinguishes a supplier scoring 71 from one scoring 2^63.
    const low = await ComplianceSimulator.deploy(THRESHOLD + 1n, THRESHOLD);
    const high = await ComplianceSimulator.deploy(9223372036854775807n, THRESHOLD);

    low.proveCompliance();
    high.proveCompliance();

    expect(low.ledger.publicMinimumScore).toBe(high.ledger.publicMinimumScore);
    expect(low.ledger.verifiedClaims).toBe(high.ledger.verifiedClaims);
    expect(renderDeep(low.ledger)).toBe(renderDeep(high.ledger));
  });
});

describe('witness implementation', () => {
  it('returns the private score without mutating private state', () => {
    const privateState = createCompliancePrivateState(PRIVATE_SCORE);

    const [nextState, value] = witnesses.complianceScore({
      ledger: { publicMinimumScore: THRESHOLD, verifiedClaims: 0n },
      privateState,
      contractAddress: '00'.repeat(32),
    });

    expect(value).toBe(PRIVATE_SCORE);
    expect(nextState).toEqual(privateState);
  });
});

describe('policy threshold parsing', () => {
  it('falls back when unset', () => {
    expect(parseMinimumScore(undefined, 70n)).toBe(70n);
    expect(parseMinimumScore('', 70n)).toBe(70n);
  });

  it('accepts valid unsigned integers', () => {
    expect(parseMinimumScore('0')).toBe(0n);
    expect(parseMinimumScore(' 12345 ')).toBe(12345n);
    expect(parseMinimumScore('18446744073709551615')).toBe(18446744073709551615n);
  });

  it('rejects values the contract Uint<64> cannot hold', () => {
    expect(() => parseMinimumScore('-1')).toThrow(/non-negative integer/);
    expect(() => parseMinimumScore('7.5')).toThrow(/non-negative integer/);
    expect(() => parseMinimumScore('abc')).toThrow(/non-negative integer/);
    expect(() => parseMinimumScore('18446744073709551616')).toThrow(/Uint<64>/);
  });
});
