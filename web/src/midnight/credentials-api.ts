/**
 * Browser API over the deployed credentials registry: issuer operations
 * (issue, revoke), holder operations (prove), local key/material management,
 * and an observable of public ledger state for the verifier.
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
  ) {}

  static async join(providers: EvidenceProviders, contractAddress: string, networkId: string): Promise<CredentialsApi> {
    setNetworkId(networkId);
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = (await providers.privateStateProvider.get(CREDENTIAL_PRIVATE_STATE_ID)) as
      | CredentialPrivateState
      | null;
    const deployedContract = await findDeployedContract(providers as any, {
      contractAddress,
      compiledContract: compiledCredentialsContract as any,
      privateStateId: CREDENTIAL_PRIVATE_STATE_ID,
      initialPrivateState: existing ?? createCredentialPrivateState(),
    });
    return new CredentialsApi(contractAddress, deployedContract, providers);
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

  /** Stores the issuer secret key (from the deploy) so this browser can issue/revoke. */
  async importIssuerKey(skHex: string): Promise<string> {
    hexToBytes32(skHex.trim(), 'issuer secret key');
    await this.saveState({ ...(await this.localState()), issuerSecretKeyHex: skHex.trim() });
    return derivePk(skHex.trim(), ISSUER_DOMAIN);
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
