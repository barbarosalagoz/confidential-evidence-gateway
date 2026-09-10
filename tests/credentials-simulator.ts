/**
 * In-process simulator for the Confidential Compliance Credentials contract.
 *
 * Same layer as the Level 1/2 simulators, plus block-time control: the
 * expiry check reads the block time from the query context, so tests can
 * move the clock with `setBlockTime()` and watch proofs start failing.
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
  createCredentialPrivateState,
  ISSUER_DOMAIN,
  type CredentialPrivateState,
  type CredentialLedger,
} from '../src/credentials';
import { credentialsContractModulePath } from '../src/credentials-node';

type CompiledModule = {
  Contract: new (w: typeof witnesses) => any;
  ledger: (state: any) => CredentialLedger;
  pureCircuits: { derivePk: (sk: Uint8Array, domain: Uint8Array) => Uint8Array };
};

let cached: CompiledModule | undefined;

export async function loadCredentialsModule(): Promise<CompiledModule> {
  if (cached) return cached;
  if (!fs.existsSync(credentialsContractModulePath)) {
    throw new Error(
      `Compiled contract not found at ${credentialsContractModulePath}.\n` +
        'Run `npm run compile:credentials` before `npm test`.',
    );
  }
  cached = (await import(pathToFileURL(credentialsContractModulePath).href)) as CompiledModule;
  return cached;
}

const TEST_COIN_PUBLIC_KEY = '0'.repeat(64);

export class CredentialsSimulator {
  private readonly address = sampleContractAddress();

  private constructor(
    private readonly module: CompiledModule,
    private readonly contract: any,
    public circuitContext: CircuitContext<CredentialPrivateState>,
    private blockTime: number,
  ) {}

  /**
   * Deploys with the issuer public key derived from the private state's
   * issuer secret key — exactly what the deploy script does off-chain via
   * pureCircuits.derivePk.
   */
  static async deploy(
    privateState: CredentialPrivateState = createCredentialPrivateState(),
    blockTimeSeconds: number = Math.floor(Date.now() / 1000),
  ): Promise<CredentialsSimulator> {
    const module = await loadCredentialsModule();
    const contract = new module.Contract(witnesses);
    if (!privateState.issuerSecretKeyHex) throw new Error('simulator deploy needs an issuer secret key');
    const issuerPk = module.pureCircuits.derivePk(
      Uint8Array.from(Buffer.from(privateState.issuerSecretKeyHex, 'hex')),
      ISSUER_DOMAIN,
    );

    const { currentPrivateState, currentContractState, currentZswapLocalState } = contract.initialState(
      createConstructorContext(privateState, TEST_COIN_PUBLIC_KEY),
      issuerPk,
    );

    const sim = new CredentialsSimulator(module, contract, undefined as never, blockTimeSeconds);
    sim.circuitContext = createCircuitContext<CredentialPrivateState>(
      sim.address,
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
      undefined,
      undefined,
      blockTimeSeconds,
    );
    return sim;
  }

  get ledger(): CredentialLedger {
    return this.module.ledger(this.circuitContext.currentQueryContext.state);
  }

  get privateState(): CredentialPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  derivePk(sk: Uint8Array, domain: Uint8Array): Uint8Array {
    return this.module.pureCircuits.derivePk(sk, domain);
  }

  /** Swaps the local private state — e.g. to act as a different party. */
  setPrivateState(privateState: CredentialPrivateState): void {
    this.circuitContext = { ...this.circuitContext, currentPrivateState: privateState };
  }

  /** Moves the simulated block clock; the ledger state carries over. */
  setBlockTime(seconds: number): void {
    this.blockTime = seconds;
    this.circuitContext = createCircuitContext<CredentialPrivateState>(
      this.address,
      this.circuitContext.currentZswapLocalState,
      this.circuitContext.currentQueryContext.state,
      this.circuitContext.currentPrivateState,
      undefined,
      undefined,
      seconds,
    );
  }

  get currentBlockTime(): number {
    return this.blockTime;
  }

  issueCredential(credentialId: bigint, typeId: bigint, expiry: bigint): CircuitResults<CredentialPrivateState, []> {
    const results = this.contract.impureCircuits.issueCredential(this.circuitContext, credentialId, typeId, expiry);
    this.circuitContext = results.context;
    return results;
  }

  revokeCredential(credentialId: bigint): CircuitResults<CredentialPrivateState, []> {
    const results = this.contract.impureCircuits.revokeCredential(this.circuitContext, credentialId);
    this.circuitContext = results.context;
    return results;
  }

  proveCredential(credentialId: bigint): CircuitResults<CredentialPrivateState, []> {
    const results = this.contract.impureCircuits.proveCredential(this.circuitContext, credentialId);
    this.circuitContext = results.context;
    return results;
  }
}
