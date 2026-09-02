/**
 * Shared wiring for the Compliance-Evidence Commitment contract (Level 2).
 *
 * This is the single place that knows how a PRIVATE evidence record reaches
 * the circuit. Everything here runs client-side only: the record's digest and
 * commitment salt are fed to the prover as witnesses and never appear in the
 * transaction's public transcript.
 *
 * This module is environment-agnostic (no Node imports) because the browser
 * frontend imports it too. Node-only path helpers live in evidence-node.ts.
 */
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/** Public ledger state, as read back from the chain. */
export type EvidenceLedger = {
  readonly evidenceCommitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key: bigint): boolean;
    lookup(key: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>;
  };
  readonly verifiedControls: {
    isEmpty(): boolean;
    size(): bigint;
    member(key: bigint): boolean;
    lookup(key: bigint): boolean;
    [Symbol.iterator](): Iterator<[bigint, boolean]>;
  };
  readonly totalVerifications: bigint;
};

/** One private evidence record, keyed by control ID in the private state. */
export type EvidenceRecord = {
  /** SHA-256 of the evidence content, hex. Private. */
  readonly digestHex: string;
  /** 32 random bytes, hex. Blinds the commitment. Private. */
  readonly saltHex: string;
  /**
   * The evidence content itself, kept only so the holder can re-derive the
   * digest and show the record to themselves. Optional: proving needs only
   * digest + salt. Private.
   */
  readonly content?: string;
};

/**
 * The prover's private state: evidence records per control ID. Held in the
 * local private-state store, never transmitted.
 */
export type EvidencePrivateState = {
  readonly records: Readonly<Record<string, EvidenceRecord>>;
};

export const createEvidencePrivateState = (
  records: Record<string, EvidenceRecord> = {},
): EvidencePrivateState => ({ records });

export const withEvidenceRecord = (
  state: EvidencePrivateState,
  controlId: bigint,
  record: EvidenceRecord,
): EvidencePrivateState => ({
  records: { ...state.records, [controlId.toString()]: record },
});

const HEX_RE = /^[0-9a-f]{64}$/i;

export function hexToBytes32(hex: string, what: string): Uint8Array {
  if (!HEX_RE.test(hex)) {
    throw new Error(`${what} must be 64 hex characters (32 bytes), got ${hex.length} chars`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function requireRecord(state: EvidencePrivateState, controlId: bigint): EvidenceRecord {
  const record = state.records[controlId.toString()];
  if (!record) {
    // Throwing here aborts proving locally: no proof, no transaction, no
    // on-chain trace. A missing record is invisible to observers.
    throw new Error(`No local evidence record for control ${controlId}. Register evidence first.`);
  }
  return record;
}

/**
 * Witness implementations. The circuit calls these for the digest and salt;
 * their return values land in the private transcript, which stays on the
 * prover's machine.
 */
export const witnesses = {
  evidenceDigest: (
    { privateState }: WitnessContext<EvidenceLedger, EvidencePrivateState>,
    controlId: bigint,
  ): [EvidencePrivateState, Uint8Array] => [
    privateState,
    hexToBytes32(requireRecord(privateState, controlId).digestHex, 'evidence digest'),
  ],
  evidenceSalt: (
    { privateState }: WitnessContext<EvidenceLedger, EvidencePrivateState>,
    controlId: bigint,
  ): [EvidencePrivateState, Uint8Array] => [
    privateState,
    hexToBytes32(requireRecord(privateState, controlId).saltHex, 'evidence salt'),
  ],
};

/** Namespace for this contract's entry in the private-state store. */
export const EVIDENCE_PRIVATE_STATE_ID = 'evidenceRegistryPrivateState';

/** Store name for the private-state provider (Node LevelDB store). */
export const EVIDENCE_PRIVATE_STATE_STORE_NAME = 'evidence-registry-state';

/** Contract name; artifacts live under contracts/managed/<name>. */
export const EVIDENCE_CONTRACT_NAME = 'evidence';

/** Uint<64> range guard for control IDs coming from UI/CLI input. */
export function parseControlId(raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Control ID must be a non-negative integer, got: ${raw}`);
  }
  const v = BigInt(trimmed);
  if (v > 18446744073709551615n) {
    throw new Error(`Control ID exceeds Uint<64> range: ${raw}`);
  }
  return v;
}

/**
 * Builds a full private evidence record from raw evidence content:
 * SHA-256 digest via Web Crypto (browser and Node 22+) plus a fresh random
 * salt. Async because subtle.digest is async; called before proving, never
 * inside a witness.
 */
export async function createEvidenceRecord(content: string): Promise<EvidenceRecord> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)));
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return { digestHex: bytesToHex(digest), saltHex: bytesToHex(salt), content };
}
