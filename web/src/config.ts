/**
 * App configuration: target network and the deployed contract address.
 *
 * The address resolves, in order, from:
 *   1. VITE_CONTRACT_ADDRESS at build time,
 *   2. deployments/evidence.<network>.json committed by `npm run deploy:evidence`,
 *   3. whatever the user pastes into the join field at runtime.
 */

export type NetworkId = 'undeployed' | 'preview' | 'preprod';

export const NETWORK_ID: NetworkId = (import.meta.env.VITE_NETWORK_ID as NetworkId) || 'preprod';

/** Read-only indexer endpoints for the auditor view (no wallet involved). */
export const INDEXER_HTTP: Record<NetworkId, string> = {
  undeployed: 'http://127.0.0.1:8088/api/v4/graphql',
  preview: 'https://indexer.preview.midnight.network/api/v4/graphql',
  preprod: 'https://indexer.preprod.midnight.network/api/v4/graphql',
};

type DeploymentFile = {
  network?: string;
  contractAddress?: string;
  deployTxId?: string;
  blockHeight?: string;
};

const deploymentModules = import.meta.glob('../../deployments/*.json', {
  eager: true,
}) as Record<string, DeploymentFile>;

function findDeployment(contract: 'evidence' | 'credentials'): DeploymentFile | null {
  for (const [file, dep] of Object.entries(deploymentModules)) {
    if (file.endsWith(`${contract}.${NETWORK_ID}.json`) && dep.contractAddress) return dep;
  }
  return null;
}

/** Level 2 evidence registry. */
export function defaultDeployment(): DeploymentFile | null {
  const fromEnv = import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined;
  if (fromEnv) return { network: NETWORK_ID, contractAddress: fromEnv };
  return findDeployment('evidence');
}

/** Level 3 credentials registry. */
export function defaultCredentialsDeployment(): (DeploymentFile & { issuerPublicKey?: string }) | null {
  const fromEnv = import.meta.env.VITE_CREDENTIALS_ADDRESS as string | undefined;
  if (fromEnv) return { network: NETWORK_ID, contractAddress: fromEnv };
  return findDeployment('credentials');
}
