/**
 * Node-only companions to src/credentials.ts: artifact paths and the runtime
 * loader that attaches the witnesses.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { witnesses, CREDENTIAL_CONTRACT_NAME } from './credentials';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const credentialsZkConfigPath = path.resolve(
  moduleDir,
  '..',
  'contracts',
  'managed',
  CREDENTIAL_CONTRACT_NAME,
);

export const credentialsContractModulePath = path.join(credentialsZkConfigPath, 'contract', 'index.js');

export function isCredentialsCompiled(): boolean {
  return fs.existsSync(credentialsContractModulePath);
}

export interface LoadedCredentialsContract {
  readonly module: any;
  readonly compiledContract: any;
}

export async function loadCredentialsContract(): Promise<LoadedCredentialsContract> {
  if (!isCredentialsCompiled()) {
    throw new Error(
      `Compiled contract missing at ${credentialsContractModulePath}. Run: npm run compile:credentials`,
    );
  }
  const module = await import(pathToFileURL(credentialsContractModulePath).href);
  const compiledContract = CompiledContract.make(CREDENTIAL_CONTRACT_NAME, module.Contract).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(credentialsZkConfigPath),
  );
  return { module, compiledContract };
}
