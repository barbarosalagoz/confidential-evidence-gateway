/**
 * The auditor's view: reads the registry's public state straight from the
 * indexer with NO wallet, no connection, no proof server. This is exactly the
 * information available to any observer on the network — which is the point
 * of the demo: the verified flags are visible, the evidence is not.
 */
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { fromHex } from '@midnight-ntwrk/midnight-js-utils';
import { INDEXER_HTTP, NETWORK_ID } from '../config';
import { readLedger, type PublicRegistryState } from './evidence-api';
import { readCredentialLedger, type CredentialRegistryState } from './credentials-api';

export type AuditorSnapshot = {
  state: PublicRegistryState;
  txHash: string | null;
  blockHeight: number | null;
  blockTime: string | null;
};

export type VerifierSnapshot = Omit<AuditorSnapshot, 'state'> & { state: CredentialRegistryState };

/** Raw contract state of the latest action, straight from the indexer. */
async function fetchLatestAction(contractAddress: string): Promise<{ stateData: unknown; txHash: string | null; blockHeight: number | null; blockTime: string | null }> {
  const query = `{
    contractAction(address: ${JSON.stringify(contractAddress)}) {
      __typename
      address
      state
      transaction { hash block { height timestamp } }
    }
  }`;
  const res = await fetch(INDEXER_HTTP[NETWORK_ID], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Indexer responded ${res.status}`);
  const body = (await res.json()) as any;
  if (body.errors) throw new Error(`Indexer error: ${JSON.stringify(body.errors)}`);
  const action = body.data?.contractAction;
  if (!action) throw new Error(`No contract found at this address on ${NETWORK_ID}.`);
  const block = action.transaction?.block ?? {};
  return {
    stateData: ContractState.deserialize(fromHex(action.state)).data,
    txHash: action.transaction?.hash ?? null,
    blockHeight: block.height ?? null,
    blockTime: block.timestamp ? new Date(block.timestamp).toISOString() : null,
  };
}

/** Level 3 verifier: credentials registry public state, no wallet. */
export async function fetchCredentialPublicState(contractAddress: string): Promise<VerifierSnapshot> {
  const { stateData, ...meta } = await fetchLatestAction(contractAddress);
  return { state: readCredentialLedger(stateData), ...meta };
}

/** Level 2 auditor: evidence registry public state, no wallet. */
export async function fetchPublicState(contractAddress: string): Promise<AuditorSnapshot> {
  const { stateData, ...meta } = await fetchLatestAction(contractAddress);
  return { state: readLedger(stateData), ...meta };
}
