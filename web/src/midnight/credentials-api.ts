/**
 * Browser API over the deployed credentials registry: issuer operations
 * (issue, revoke), holder operations (prove), local key/material management,
 * and an observable of public ledger state for the verifier.
 *
 * The issuer secret key is the one piece of private state that is never
 * persisted: it lives in this object's memory for the lifetime of the tab
 * (see `withSessionIssuerKey`). Holder key and credential material stay in
 * the localStorage-backed provider as before.
 */
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as CredentialsModule from '../../../contracts/managed/credentials/contract/index.js';
import {
  witnesses,
  createCredentialPrivateState,
  createCredentialRecord,
  createCredentialRecordFromMaterial,
  credentialCommitmentHex,
  withCredentialRecord,
  generateSecretKeyHex,
  hexToBytes32,
  bytesToHex,
  credentialStatus,
  HOLDER_DOMAIN,
  ISSUER_DOMAIN,
  CREDENTIAL_PRIVATE_STATE_ID,
  type CredentialPrivateState,
  type CredentialStatus,
} from '../../../src/credentials';

/** What the holder's machine would commit to, next to what the chain holds. */
export type CredentialDiagnosis = {
  credentialId: bigint;
  holderPkHex: string | null;
  digestHex: string | null;
  saltHex: string | null;
  localCommitmentHex: string | null;
  onChainCommitmentHex: string | null;
  matches: boolean | null;
};
import type { EvidenceProviders } from './providers';
import type { TxReceipt } from './evidence-api';
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

/** Tab-lifetime holder for the issuer secret key. Never serialised. */
type IssuerKeySession = { issuerSecretKeyHex?: string };

/**
 * Wraps the persisted private-state provider so the issuer secret key never
 * reaches storage. The SDK reads private state through `get` before a circuit
 * runs and writes the witness-updated state back through `set` afterwards;
 * this layer injects the in-memory key on the way out and strips it on the
 * way in. Everything else (holder key, credential material) passes through
 * unchanged. The browser demo used to persist the key in localStorage; a
 * production issuer signs from the CLI with the key file on disk, or from an
 * HSM-backed signer.
 */
export function withSessionIssuerKey(
  inner: PrivateStateProvider<string, any>,
  session: IssuerKeySession,
): PrivateStateProvider<string, any> {
  const strip = (state: any): any => {
    if (!state || typeof state !== 'object' || !('issuerSecretKeyHex' in state)) return state;
    const { issuerSecretKeyHex: _dropped, ...rest } = state as CredentialPrivateState;
    void _dropped;
    return rest;
  };
  return {
    ...inner,
    async get(privateStateId: string): Promise<any> {
      const stored = strip(await inner.get(privateStateId));
      if (privateStateId !== CREDENTIAL_PRIVATE_STATE_ID || !stored || !session.issuerSecretKeyHex) return stored;
      return { ...stored, issuerSecretKeyHex: session.issuerSecretKeyHex };
    },
    async set(privateStateId: string, state: any): Promise<void> {
      await inner.set(privateStateId, privateStateId === CREDENTIAL_PRIVATE_STATE_ID ? strip(state) : state);
    },
  };
}

export type CredentialRow = {
  credentialId: bigint;
  typeId: bigint;
  expirySeconds: bigint;
  commitmentHex: string;
  revoked: boolean;
  verified: boolean;
  status: CredentialStatus;
};

export type CredentialRegistryState = {
  issuerPkHex: string;
  rows: CredentialRow[];
  totalProofs: bigint;
};

export type CredentialReceipt = Omit<TxReceipt, 'circuit'> & {
  circuit: 'issueCredential' | 'revokeCredential' | 'proveCredential';
};

const compiledCredentialsContract = CompiledContract.make(
  'credentials',
  (CredentialsModule as any).Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets('./contracts/managed/credentials'),
);

export function derivePk(skHex: string, domain: Uint8Array): string {
  return bytesToHex((CredentialsModule as any).pureCircuits.derivePk(hexToBytes32(skHex, 'secret key'), domain));
}

export function readCredentialLedger(contractStateData: unknown, nowSeconds = BigInt(Math.floor(Date.now() / 1000))): CredentialRegistryState {
  const ledger = (CredentialsModule as any).ledger(contractStateData);
  const rows: CredentialRow[] = [];
  for (const [credentialId, commitment] of ledger.credentialCommitments as Iterable<[bigint, Uint8Array]>) {
    const revoked = ledger.revokedCredentials.member(credentialId) as boolean;
    const expirySeconds = ledger.credentialExpiry.lookup(credentialId) as bigint;
    const verified = ledger.verifiedCredentials.member(credentialId) && ledger.verifiedCredentials.lookup(credentialId);
    rows.push({
      credentialId,
      typeId: ledger.credentialTypes.lookup(credentialId) as bigint,
      expirySeconds,
      commitmentHex: bytesToHex(commitment),
      revoked,
      verified,
      status: credentialStatus(revoked, expirySeconds, verified, nowSeconds),
    });
  }
  rows.sort((a, b) => (a.credentialId < b.credentialId ? -1 : a.credentialId > b.credentialId ? 1 : 0));
  return { issuerPkHex: bytesToHex(ledger.issuerPk), rows, totalProofs: ledger.totalCredentialProofs as bigint };
}

export class CredentialsApi {
  private constructor(
    public readonly contractAddress: string,
    private readonly deployedContract: any,
    private readonly providers: EvidenceProviders,
    private readonly session: IssuerKeySession,
    /** True when a key persisted by an earlier version of the app was found and removed on join. */
    public readonly removedPersistedIssuerKey: boolean,
  ) {}

  static async join(providers: EvidenceProviders, contractAddress: string, networkId: string): Promise<CredentialsApi> {
    setNetworkId(networkId);
    const session: IssuerKeySession = {};
    const persisted = providers.privateStateProvider;
    persisted.setContractAddress(contractAddress);
    const stored = (await persisted.get(CREDENTIAL_PRIVATE_STATE_ID)) as CredentialPrivateState | null;
    // Earlier versions of this app persisted the issuer key here. Remove it
    // from storage without carrying it into this session: the issuer pastes
    // the key again, per tab.
    const removedPersistedIssuerKey = Boolean(stored?.issuerSecretKeyHex);
    const wrapped = withSessionIssuerKey(persisted, session);
    if (removedPersistedIssuerKey) await wrapped.set(CREDENTIAL_PRIVATE_STATE_ID, stored);
    const sessionProviders: EvidenceProviders = { ...providers, privateStateProvider: wrapped };
    const deployedContract = await findDeployedContract(sessionProviders as any, {
      contractAddress,
      compiledContract: compiledCredentialsContract as any,
      privateStateId: CREDENTIAL_PRIVATE_STATE_ID,
      initialPrivateState: (await wrapped.get(CREDENTIAL_PRIVATE_STATE_ID)) ?? createCredentialPrivateState(),
    });
    return new CredentialsApi(contractAddress, deployedContract, sessionProviders, session, removedPersistedIssuerKey);
  }

  async localState(): Promise<CredentialPrivateState> {
    this.providers.privateStateProvider.setContractAddress(this.contractAddress);
    const state = (await this.providers.privateStateProvider.get(CREDENTIAL_PRIVATE_STATE_ID)) as
      | CredentialPrivateState
      | null;
    return state ?? createCredentialPrivateState();
  }

  private async saveState(state: CredentialPrivateState): Promise<void> {
    this.providers.privateStateProvider.setContractAddress(this.contractAddress);
    await this.providers.privateStateProvider.set(CREDENTIAL_PRIVATE_STATE_ID, state);
  }

  // ── Keys (local only) ────────────────────────────────────────────────────

  /**
   * Holds the issuer secret key (from the deploy's key file) in this tab's
   * memory so the issuer circuits can run. Nothing is written to storage;
   * `clearIssuerKey` or closing the tab discards it.
   */
  async importIssuerKey(skHex: string): Promise<string> {
    const key = skHex.trim();
    hexToBytes32(key, 'issuer secret key');
    this.session.issuerSecretKeyHex = key;
    return derivePk(key, ISSUER_DOMAIN);
  }

  hasIssuerKey(): boolean {
    return Boolean(this.session.issuerSecretKeyHex);
  }

  clearIssuerKey(): void {
    delete this.session.issuerSecretKeyHex;
  }

  /** Generates (once) a holder key; returns the holder public key to give the issuer. */
  async ensureHolderKey(): Promise<string> {
    const state = await this.localState();
    const skHex = state.holderSecretKeyHex ?? generateSecretKeyHex();
    if (!state.holderSecretKeyHex) await this.saveState({ ...state, holderSecretKeyHex: skHex });
    return derivePk(skHex, HOLDER_DOMAIN);
  }

  // ── Issuer ───────────────────────────────────────────────────────────────

  /**
   * Issuer: creates the credential material (content digest + salt, holder
   * pk) locally and calls issueCredential. Only type and expiry go public.
   * Returns the material the issuer hands to the holder out-of-band.
   */
  async issueCredential(
    credentialId: bigint,
    holderPkHex: string,
    typeId: bigint,
    expirySeconds: bigint,
    content: string,
  ): Promise<{ receipt: CredentialReceipt; handover: { digestHex: string; saltHex: string; content: string } }> {
    hexToBytes32(holderPkHex.trim(), 'holder public key');
    const record = { ...(await createCredentialRecord(content)), holderPkHex: holderPkHex.trim() };
    await this.saveState(withCredentialRecord(await this.localState(), credentialId, record));
    const txData = await this.deployedContract.callTx.issueCredential(credentialId, typeId, expirySeconds);
    return {
      receipt: { circuit: 'issueCredential', txHash: txData.public.txHash, blockHeight: txData.public.blockHeight },
      handover: { digestHex: record.digestHex, saltHex: record.saltHex, content },
    };
  }

  async revokeCredential(credentialId: bigint): Promise<CredentialReceipt> {
    const txData = await this.deployedContract.callTx.revokeCredential(credentialId);
    return { circuit: 'revokeCredential', txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
  }

  // ── Holder ───────────────────────────────────────────────────────────────

  /** Holder stores the material received from the issuer (content + salt). Same digest path as the CLI. */
  async importCredentialMaterial(credentialId: bigint, content: string, saltHex: string): Promise<void> {
    const record = await createCredentialRecordFromMaterial(content, saltHex);
    await this.saveState(withCredentialRecord(await this.localState(), credentialId, record));
  }

  /**
   * Computes, from this browser's private state, exactly what proveCredential
   * would commit to — holder pk derived from the stored secret key, the stored
   * digest and salt — and compares it with the on-chain commitment. Lets the
   * holder see a mismatch (and which input to check) before spending a proof.
   */
  async diagnose(credentialId: bigint, onChainCommitmentHex: string | null): Promise<CredentialDiagnosis> {
    const state = await this.localState();
    const record = state.credentials[credentialId.toString()];
    const holderPkHex = state.holderSecretKeyHex ? derivePk(state.holderSecretKeyHex, HOLDER_DOMAIN) : null;
    const digestHex = record?.digestHex ?? null;
    const saltHex = record?.saltHex ?? null;
    const localCommitmentHex =
      holderPkHex && digestHex && saltHex ? credentialCommitmentHex(digestHex, holderPkHex, saltHex) : null;
    return {
      credentialId,
      holderPkHex,
      digestHex,
      saltHex,
      localCommitmentHex,
      onChainCommitmentHex,
      matches: localCommitmentHex && onChainCommitmentHex ? localCommitmentHex === onChainCommitmentHex : null,
    };
  }

  async proveCredential(credentialId: bigint): Promise<CredentialReceipt> {
    const txData = await this.deployedContract.callTx.proveCredential(credentialId);
    return { circuit: 'proveCredential', txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
  }

  // ── Verifier ─────────────────────────────────────────────────────────────

  watchPublicState(onState: (state: CredentialRegistryState) => void, onError: (err: Error) => void): () => void {
    const subscription = this.providers.publicDataProvider
      .contractStateObservable(this.contractAddress, { type: 'latest' })
      .subscribe({
        next: (contractState: any) => onState(readCredentialLedger(contractState.data)),
        error: (err: unknown) => onError(err instanceof Error ? err : new Error(String(err))),
      });
    return () => subscription.unsubscribe();
  }
}
