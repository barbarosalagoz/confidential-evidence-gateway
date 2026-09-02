/**
 * Browser API over the deployed evidence registry: joins the contract through
 * the wallet-backed providers, manages the local (private) evidence records,
 * and exposes the two circuits plus an observable of public ledger state.
 */
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as EvidenceContractModule from '../../../contracts/managed/evidence/contract/index.js';
import {
  witnesses,
  createEvidencePrivateState,
  createEvidenceRecord,
  withEvidenceRecord,
  bytesToHex,
  EVIDENCE_PRIVATE_STATE_ID,
  type EvidencePrivateState,
  type EvidenceRecord,
} from '../../../src/evidence';
import type { EvidenceProviders } from './providers';

export type PublicControlRow = {
  controlId: bigint;
  commitmentHex: string;
  verified: boolean;
};

export type PublicRegistryState = {
  rows: PublicControlRow[];
  totalVerifications: bigint;
};

export type TxReceipt = {
  circuit: 'registerEvidence' | 'proveEvidence';
  txHash: string;
  blockHeight: bigint | number | undefined;
};

const compiledEvidenceContract = CompiledContract.make(
  'evidence',
  (EvidenceContractModule as any).Contract,
).pipe(
  // Runtime-loaded module is untyped; same widening as the Node loader.
  CompiledContract.withWitnesses(witnesses as never),
  // Path metadata only: in the browser the FetchZkConfigProvider serves the
  // artifacts from the origin, so this path is never read from disk.
  CompiledContract.withCompiledFileAssets('./contracts/managed/evidence'),
);

export function readLedger(contractStateData: unknown): PublicRegistryState {
  const ledger = (EvidenceContractModule as any).ledger(contractStateData);
  const rows: PublicControlRow[] = [];
  for (const [controlId, commitment] of ledger.evidenceCommitments as Iterable<[bigint, Uint8Array]>) {
    const verified = ledger.verifiedControls.member(controlId) && ledger.verifiedControls.lookup(controlId);
    rows.push({ controlId, commitmentHex: bytesToHex(commitment), verified });
  }
  rows.sort((a, b) => (a.controlId < b.controlId ? -1 : a.controlId > b.controlId ? 1 : 0));
  return { rows, totalVerifications: ledger.totalVerifications as bigint };
}

export class EvidenceApi {
  private constructor(
    public readonly contractAddress: string,
    private readonly deployedContract: any,
    private readonly providers: EvidenceProviders,
  ) {}

  /** Joins the deployed registry at the given address. */
  static async join(
    providers: EvidenceProviders,
    contractAddress: string,
    networkId: string,
  ): Promise<EvidenceApi> {
    setNetworkId(networkId);
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = await providers.privateStateProvider.get(EVIDENCE_PRIVATE_STATE_ID);
    const deployedContract = await findDeployedContract(providers as any, {
      contractAddress,
      compiledContract: compiledEvidenceContract as any,
      privateStateId: EVIDENCE_PRIVATE_STATE_ID,
      initialPrivateState: existing ?? createEvidencePrivateState(),
    });
    return new EvidenceApi(contractAddress, deployedContract, providers);
  }

  /** The local, never-transmitted evidence records. */
  async localRecords(): Promise<EvidencePrivateState> {
    const state = await this.providers.privateStateProvider.get(EVIDENCE_PRIVATE_STATE_ID);
    return state ?? createEvidencePrivateState();
  }

  /**
   * Creates the private record for a control (digest + fresh salt, kept in
   * localStorage) and calls registerEvidence(controlId) on-chain, which
   * publishes only the opaque commitment.
   */
  async registerEvidence(controlId: bigint, content: string): Promise<TxReceipt> {
    const record: EvidenceRecord = await createEvidenceRecord(content);
    const state = await this.localRecords();
    await this.providers.privateStateProvider.set(
      EVIDENCE_PRIVATE_STATE_ID,
      withEvidenceRecord(state, controlId, record),
    );
    const txData = await this.deployedContract.callTx.registerEvidence(controlId);
    return {
      circuit: 'registerEvidence',
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
    };
  }

  /**
   * Proves knowledge of the evidence behind the registered commitment. Only
   * proof success/failure is observable; digest and salt stay local.
   */
  async proveEvidence(controlId: bigint): Promise<TxReceipt> {
    const txData = await this.deployedContract.callTx.proveEvidence(controlId);
    return {
      circuit: 'proveEvidence',
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
    };
  }

  /** Live public state as any observer sees it, via the indexer. */
  watchPublicState(onState: (state: PublicRegistryState) => void, onError: (err: Error) => void): () => void {
    const subscription = this.providers.publicDataProvider
      .contractStateObservable(this.contractAddress, { type: 'latest' })
      .subscribe({
        next: (contractState: any) => onState(readLedger(contractState.data)),
        error: (err: unknown) => onError(err instanceof Error ? err : new Error(String(err))),
      });
    return () => subscription.unsubscribe();
  }
}
