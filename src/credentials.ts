/**
 * Shared wiring for the Confidential Compliance Credentials contract (Level 3).
 *
 * Private state holds up to three kinds of secrets, all local:
 *   - the issuer's secret key (only on the issuer's machine)
 *   - the holder's secret key (only on the holder's machine)
 *   - per credential ID: the content, its digest and the commitment salt
 *     (issuer creates them; the holder receives them out-of-band)
 *
 * Environment-agnostic (no Node imports) — the browser imports this too.
 */
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { bytesToHex, hexToBytes32 } from './evidence';

export { bytesToHex, hexToBytes32 };

export type CredentialLedger = {
  readonly issuerPk: Uint8Array;
  readonly credentialCommitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key: bigint): boolean;
    lookup(key: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>;
  };
  readonly credentialTypes: {
    member(key: bigint): boolean;
    lookup(key: bigint): bigint;
    [Symbol.iterator](): Iterator<[bigint, bigint]>;
  };
  readonly credentialExpiry: {
    member(key: bigint): boolean;
    lookup(key: bigint): bigint;
    [Symbol.iterator](): Iterator<[bigint, bigint]>;
  };
  readonly revokedCredentials: {
    member(elem: bigint): boolean;
    [Symbol.iterator](): Iterator<bigint>;
  };
  readonly verifiedCredentials: {
    member(key: bigint): boolean;
    lookup(key: bigint): boolean;
    [Symbol.iterator](): Iterator<[bigint, boolean]>;
  };
  readonly totalCredentialProofs: bigint;
};

/** One credential's private material, keyed by credential ID. */
export type CredentialRecord = {
  /** SHA-256 of the credential content, hex. Private. */
  readonly digestHex: string;
  /** 32 random bytes, hex. Blinds the commitment. Private. */
  readonly saltHex: string;
  /** The content itself (e.g. "SOC2 Type II — score 92"). Private, optional. */
  readonly content?: string;
  /** Holder's public key, hex. Needed only by the issuer at issuance. Private. */
  readonly holderPkHex?: string;
};

export type CredentialPrivateState = {
  /** Issuer secret key, hex. Present only on the issuer's machine. */
  readonly issuerSecretKeyHex?: string;
  /** Holder secret key, hex. Present only on the holder's machine. */
  readonly holderSecretKeyHex?: string;
  readonly credentials: Readonly<Record<string, CredentialRecord>>;
};

export const createCredentialPrivateState = (
  init: Partial<CredentialPrivateState> = {},
): CredentialPrivateState => ({
  issuerSecretKeyHex: init.issuerSecretKeyHex,
  holderSecretKeyHex: init.holderSecretKeyHex,
  credentials: init.credentials ?? {},
});

export const withCredentialRecord = (
  state: CredentialPrivateState,
  credentialId: bigint,
  record: CredentialRecord,
): CredentialPrivateState => ({
  ...state,
  credentials: { ...state.credentials, [credentialId.toString()]: record },
});

/** Domain separators — must match the `pad(32, "...")` literals in the contract. */
export const ISSUER_DOMAIN = padDomain('cred:issuer');
export const HOLDER_DOMAIN = padDomain('cred:holder');

function padDomain(label: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(label));
  return out;
}

function requireKey(hex: string | undefined, role: 'issuer' | 'holder'): Uint8Array {
  if (!hex) {
    // Aborts proving locally: no proof, no transaction, no trace.
    throw new Error(`No local ${role} secret key. This machine cannot act as the ${role}.`);
  }
  return hexToBytes32(hex, `${role} secret key`);
}

function requireCredential(state: CredentialPrivateState, credentialId: bigint): CredentialRecord {
  const record = state.credentials[credentialId.toString()];
  if (!record) {
    throw new Error(`No local material for credential ${credentialId}.`);
  }
  return record;
}

export const witnesses = {
  issuerSecretKey: ({
    privateState,
  }: WitnessContext<CredentialLedger, CredentialPrivateState>): [CredentialPrivateState, Uint8Array] => [
    privateState,
    requireKey(privateState.issuerSecretKeyHex, 'issuer'),
  ],
  holderSecretKey: ({
    privateState,
  }: WitnessContext<CredentialLedger, CredentialPrivateState>): [CredentialPrivateState, Uint8Array] => [
    privateState,
    requireKey(privateState.holderSecretKeyHex, 'holder'),
  ],
  holderPublicKey: (
    { privateState }: WitnessContext<CredentialLedger, CredentialPrivateState>,
    credentialId: bigint,
  ): [CredentialPrivateState, Uint8Array] => {
    const record = requireCredential(privateState, credentialId);
    if (!record.holderPkHex) {
      throw new Error(`No holder public key recorded for credential ${credentialId} (issuer-side material).`);
    }
    return [privateState, hexToBytes32(record.holderPkHex, 'holder public key')];
  },
  credentialDigest: (
    { privateState }: WitnessContext<CredentialLedger, CredentialPrivateState>,
    credentialId: bigint,
  ): [CredentialPrivateState, Uint8Array] => [
    privateState,
    hexToBytes32(requireCredential(privateState, credentialId).digestHex, 'credential digest'),
  ],
  credentialSalt: (
    { privateState }: WitnessContext<CredentialLedger, CredentialPrivateState>,
    credentialId: bigint,
  ): [CredentialPrivateState, Uint8Array] => [
    privateState,
    hexToBytes32(requireCredential(privateState, credentialId).saltHex, 'credential salt'),
  ],
};

export const CREDENTIAL_PRIVATE_STATE_ID = 'credentialRegistryPrivateState';
export const CREDENTIAL_PRIVATE_STATE_STORE_NAME = 'credential-registry-state';
export const CREDENTIAL_CONTRACT_NAME = 'credentials';

/** Fresh 32-byte secret key, hex. */
export function generateSecretKeyHex(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** Builds a credential's private material from its content. */
export async function createCredentialRecord(content: string): Promise<CredentialRecord> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)));
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return { digestHex: bytesToHex(digest), saltHex: bytesToHex(salt), content };
}

const UINT64_MAX = 18446744073709551615n;

export function parseUint64(raw: string, what: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`${what} must be a non-negative integer, got: ${raw}`);
  const v = BigInt(trimmed);
  if (v > UINT64_MAX) throw new Error(`${what} exceeds Uint<64> range: ${raw}`);
  return v;
}

/** ISO date/datetime → seconds since epoch as a Uint<64>, matching block time units. */
export function isoToEpochSeconds(iso: string): bigint {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Invalid date: ${iso}`);
  return BigInt(Math.floor(ms / 1000));
}

/** Verifier-side status derived from public state plus the verifier's own clock. */
export type CredentialStatus = 'valid' | 'unproven' | 'revoked' | 'expired';

export function credentialStatus(
  revoked: boolean,
  expirySeconds: bigint,
  verified: boolean,
  nowSeconds: bigint,
): CredentialStatus {
  if (revoked) return 'revoked';
  if (nowSeconds >= expirySeconds) return 'expired';
  return verified ? 'valid' : 'unproven';
}
