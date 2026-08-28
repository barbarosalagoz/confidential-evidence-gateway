/**
 * Shared wiring for the Confidential Compliance Proof contract.
 *
 * This is the single place that knows how the supplier's PRIVATE compliance
 * score reaches the circuit. Everything here runs client-side only: the score
 * is fed to the prover as a witness and is never included in the transaction's
 * public transcript, so it never reaches the chain.
 *
 * See docs/THREAT_MODEL.md for what an observer can and cannot infer.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/** Public ledger state, as read back from the chain. */
export type ComplianceLedger = {
  readonly publicMinimumScore: bigint;
  readonly verifiedClaims: bigint;
};

/**
 * The supplier's private state. Held locally (encrypted private-state store),
 * never transmitted. `complianceScore` is the confidential value the whole
 * design exists to protect.
 */
export type CompliancePrivateState = {
  readonly complianceScore: bigint;
};

export const createCompliancePrivateState = (complianceScore: bigint): CompliancePrivateState => ({
  complianceScore,
});

/**
 * Witness implementations. The Compact circuit calls `complianceScore()` and
 * compares the result against the public threshold inside the ZK circuit.
 * Returning the value here does NOT publish it — witness outputs land in the
 * private transcript, which stays on the prover's machine.
 */
export const witnesses = {
  complianceScore: ({
    privateState,
  }: WitnessContext<ComplianceLedger, CompliancePrivateState>): [CompliancePrivateState, bigint] => [
    privateState,
    privateState.complianceScore,
  ],
};

/** Namespace for this contract's entry in the encrypted private-state store. */
export const PRIVATE_STATE_ID = 'complianceGatewayPrivateState';

/** Store name for the LevelDB-backed private-state provider. */
export const PRIVATE_STATE_STORE_NAME = 'compliance-gateway-state';

/**
 * Contract name. The file is `contracts/counter.compact` (the Level 1
 * checklist expects that filename); the logic inside is the confidential
 * compliance proof, not a counter.
 */
export const CONTRACT_NAME = 'counter';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Directory holding compiled artifacts: contract/, keys/, zkir/. */
export const zkConfigPath = path.resolve(moduleDir, '..', 'contracts', 'managed', CONTRACT_NAME);

/** The compiled contract module emitted by `compact compile`. */
export const contractModulePath = path.join(zkConfigPath, 'contract', 'index.js');

/**
 * Default policy threshold used when deploying without an explicit value.
 * Public by design — it is the policy everyone is being held to.
 */
export const DEFAULT_MINIMUM_SCORE = 70n;

/**
 * Reads a Uint<64> threshold from an env var / CLI value, rejecting anything
 * the contract's `Uint<64>` cannot hold.
 */
export function parseMinimumScore(raw: string | undefined, fallback = DEFAULT_MINIMUM_SCORE): bigint {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`Minimum score must be a non-negative integer, got: ${raw}`);
  }
  const v = BigInt(raw.trim());
  if (v > 18446744073709551615n) {
    throw new Error(`Minimum score exceeds Uint<64> range: ${raw}`);
  }
  return v;
}
