import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  evidenceDigest(context: __compactRuntime.WitnessContext<Ledger, PS>,
                 controlId_0: bigint): [PS, Uint8Array];
  evidenceSalt(context: __compactRuntime.WitnessContext<Ledger, PS>,
               controlId_0: bigint): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  registerEvidence(context: __compactRuntime.CircuitContext<PS>,
                   controlId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveEvidence(context: __compactRuntime.CircuitContext<PS>,
                controlId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerEvidence(context: __compactRuntime.CircuitContext<PS>,
                   controlId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveEvidence(context: __compactRuntime.CircuitContext<PS>,
                controlId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  registerEvidence(context: __compactRuntime.CircuitContext<PS>,
                   controlId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveEvidence(context: __compactRuntime.CircuitContext<PS>,
                controlId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  evidenceCommitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>
  };
  verifiedControls: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): boolean;
    [Symbol.iterator](): Iterator<[bigint, boolean]>
  };
  readonly totalVerifications: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
