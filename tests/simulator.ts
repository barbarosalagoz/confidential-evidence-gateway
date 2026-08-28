/**
 * In-process simulator for the Confidential Compliance Proof contract.
 *
 * Runs the compiled circuit against a local ledger state with no network, no
 * proof server and no wallet. This is the right layer for privacy assertions:
 * it hands us the exact `proofData` the real client would send to the prover,
 * so we can inspect what is public (`publicTranscript`, ledger state) versus
 * what stays on the prover's machine (`privateTranscriptOutputs`).
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
  createCompliancePrivateState,
  contractModulePath,
  type CompliancePrivateState,
  type ComplianceLedger,
} from '../src/compliance';

/**
 * The compiled contract is a build artifact, so it is loaded at runtime and
 * arrives untyped. Tests assert against the typed `ComplianceLedger` shape
 * from src/compliance.ts instead.
 */
type CompiledModule = {
  Contract: new (w: typeof witnesses) => any;
  ledger: (state: any) => ComplianceLedger;
};

let cached: CompiledModule | undefined;

export async function loadContractModule(): Promise<CompiledModule> {
  if (cached) return cached;
  if (!fs.existsSync(contractModulePath)) {
    throw new Error(
      `Compiled contract not found at ${contractModulePath}.\n` +
        'Run `npm run compile` before `npm test`.',
    );
  }
  cached = (await import(pathToFileURL(contractModulePath).href)) as CompiledModule;
  return cached;
}

/** A zero coin public key: these tests never move funds. */
const TEST_COIN_PUBLIC_KEY = '0'.repeat(64);

export class ComplianceSimulator {
  private constructor(
    private readonly module: CompiledModule,
    private readonly contract: any,
    public circuitContext: CircuitContext<CompliancePrivateState>,
  ) {}

  /**
   * Deploys the contract locally.
   *
   * @param complianceScore the supplier's PRIVATE score (witness input)
   * @param minimumScore    the PUBLIC policy threshold (constructor argument)
   */
  static async deploy(complianceScore: bigint, minimumScore: bigint): Promise<ComplianceSimulator> {
    const module = await loadContractModule();
    const contract = new module.Contract(witnesses);

    const { currentPrivateState, currentContractState, currentZswapLocalState } = contract.initialState(
      createConstructorContext(createCompliancePrivateState(complianceScore), TEST_COIN_PUBLIC_KEY),
      minimumScore,
    );

    const circuitContext = createCircuitContext<CompliancePrivateState>(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
    );

    return new ComplianceSimulator(module, contract, circuitContext);
  }

  /** The public ledger state, exactly as an on-chain observer would read it. */
  get ledger(): ComplianceLedger {
    return this.module.ledger(this.circuitContext.currentQueryContext.state);
  }

  /** The private state held locally by the supplier. Never transmitted. */
  get privateState(): CompliancePrivateState {
    return this.circuitContext.currentPrivateState;
  }

  /**
   * Runs the compliance circuit. Throws if the assert inside the circuit
   * fails — which is what "the score is below the threshold" looks like from
   * the outside: no proof can be produced at all.
   */
  proveCompliance(): CircuitResults<CompliancePrivateState, []> {
    const results = this.contract.impureCircuits.proveCompliance(this.circuitContext);
    this.circuitContext = results.context;
    return results;
  }
}
