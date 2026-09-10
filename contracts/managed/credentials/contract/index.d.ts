import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  issuerSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  holderSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  holderPublicKey(context: __compactRuntime.WitnessContext<Ledger, PS>,
                  credentialId_0: bigint): [PS, Uint8Array];
  credentialDigest(context: __compactRuntime.WitnessContext<Ledger, PS>,
                   credentialId_0: bigint): [PS, Uint8Array];
  credentialSalt(context: __compactRuntime.WitnessContext<Ledger, PS>,
                 credentialId_0: bigint): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  issueCredential(context: __compactRuntime.CircuitContext<PS>,
                  credentialId_0: bigint,
                  typeId_0: bigint,
                  expiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   credentialId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveCredential(context: __compactRuntime.CircuitContext<PS>,
                  credentialId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  issueCredential(context: __compactRuntime.CircuitContext<PS>,
                  credentialId_0: bigint,
                  typeId_0: bigint,
                  expiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   credentialId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveCredential(context: __compactRuntime.CircuitContext<PS>,
                  credentialId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  derivePk(sk_0: Uint8Array, domain_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  derivePk(context: __compactRuntime.CircuitContext<PS>,
           sk_0: Uint8Array,
           domain_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  issueCredential(context: __compactRuntime.CircuitContext<PS>,
                  credentialId_0: bigint,
                  typeId_0: bigint,
                  expiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revokeCredential(context: __compactRuntime.CircuitContext<PS>,
                   credentialId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveCredential(context: __compactRuntime.CircuitContext<PS>,
                  credentialId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly issuerPk: Uint8Array;
  credentialCommitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>
  };
  credentialTypes: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): bigint;
    [Symbol.iterator](): Iterator<[bigint, bigint]>
  };
  credentialExpiry: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): bigint;
    [Symbol.iterator](): Iterator<[bigint, bigint]>
  };
  revokedCredentials: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: bigint): boolean;
    [Symbol.iterator](): Iterator<bigint>
  };
  verifiedCredentials: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): boolean;
    [Symbol.iterator](): Iterator<[bigint, boolean]>
  };
  readonly totalCredentialProofs: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               issuerPublicKey_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
