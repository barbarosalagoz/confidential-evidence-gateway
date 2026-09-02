/**
 * In-process simulator for the Compliance-Evidence Commitment contract.
 *
 * Same layer as simulator.ts: runs the compiled circuits against a local
 * ledger with no network, proof server or wallet, exposing the exact
 * structures a real client would produce so tests can assert what is public
 * versus what stays on the prover's machine.
 */
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
  type CircuitResults,
} from '@midnight-ntwrk/compact-runtime';
import {
  witnesses,
  createEvidencePrivateState,
  type EvidencePrivateState,
  type EvidenceLedger,
} from '../src/evidence';
import { evidenceContractModulePath } from '../src/evidence-node';

type CompiledModule = {
  Contract: new (w: typeof witnesses) => any;
  ledger: (state: any) => EvidenceLedger;
};

let cached: CompiledModule | undefined;

export async function loadEvidenceModule(): Promise<CompiledModule> {
  if (cached) return cached;
  if (!fs.existsSync(evidenceContractModulePath)) {
    throw new Error(
      `Compiled contract not found at ${evidenceContractModulePath}.\n` +
        'Run `npm run compile:evidence` before `npm test`.',
    );
  }
  cached = (await import(pathToFileURL(evidenceContractModulePath).href)) as CompiledModule;
  return cached;
}

/** A zero coin public key: these tests never move funds. */
const TEST_COIN_PUBLIC_KEY = '0'.repeat(64);

export class EvidenceSimulator {
  private constructor(
    private readonly module: CompiledModule,
    private readonly contract: any,
    public circuitContext: CircuitContext<EvidencePrivateState>,
  ) {}

  /** Deploys the contract locally with the given private evidence records. */
  static async deploy(privateState: EvidencePrivateState = createEvidencePrivateState()): Promise<EvidenceSimulator> {
    const module = await loadEvidenceModule();
    const contract = new module.Contract(witnesses);

    const { currentPrivateState, currentContractState, currentZswapLocalState } = contract.initialState(
      createConstructorContext(privateState, TEST_COIN_PUBLIC_KEY),
    );

    const circuitContext = createCircuitContext<EvidencePrivateState>(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
    );

    return new EvidenceSimulator(module, contract, circuitContext);
  }

  /** The public ledger state, exactly as an on-chain observer would read it. */
  get ledger(): EvidenceLedger {
    return this.module.ledger(this.circuitContext.currentQueryContext.state);
  }

  /** The private state held locally by the evidence holder. Never transmitted. */
  get privateState(): EvidencePrivateState {
    return this.circuitContext.currentPrivateState;
  }

  /** Replaces the private state, as a client would after adding a record. */
  setPrivateState(privateState: EvidencePrivateState): void {
    this.circuitContext = { ...this.circuitContext, currentPrivateState: privateState };
  }

  registerEvidence(controlId: bigint): CircuitResults<EvidencePrivateState, []> {
    const results = this.contract.impureCircuits.registerEvidence(this.circuitContext, controlId);
    this.circuitContext = results.context;
    return results;
  }

  proveEvidence(controlId: bigint): CircuitResults<EvidencePrivateState, []> {
    const results = this.contract.impureCircuits.proveEvidence(this.circuitContext, controlId);
    this.circuitContext = results.context;
    return results;
  }
}
