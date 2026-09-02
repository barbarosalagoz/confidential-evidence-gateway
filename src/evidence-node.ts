/**
 * Node-only companions to src/evidence.ts: filesystem paths to the compiled
 * artifacts, and the runtime loader that attaches the witnesses. Kept apart so
 * the browser frontend can import evidence.ts without pulling in node:path.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { witnesses, EVIDENCE_CONTRACT_NAME } from './evidence';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Directory holding compiled artifacts: contract/, keys/, zkir/. */
export const evidenceZkConfigPath = path.resolve(
  moduleDir,
  '..',
  'contracts',
  'managed',
  EVIDENCE_CONTRACT_NAME,
);

/** The compiled contract module emitted by `compact compile`. */
export const evidenceContractModulePath = path.join(evidenceZkConfigPath, 'contract', 'index.js');

export function isEvidenceCompiled(): boolean {
  return fs.existsSync(evidenceContractModulePath);
}

export interface LoadedEvidenceContract {
  /** The generated module: `Contract`, `ledger()`, `pureCircuits`. */
  readonly module: any;
  /** Ready to hand to deployContract / findDeployedContract. */
  readonly compiledContract: any;
}

export async function loadEvidenceContract(): Promise<LoadedEvidenceContract> {
  if (!isEvidenceCompiled()) {
    throw new Error(
      `Compiled contract missing at ${evidenceContractModulePath}. Run: npm run compile:evidence`,
    );
  }

  const module = await import(pathToFileURL(evidenceContractModulePath).href);

  const compiledContract = CompiledContract.make(EVIDENCE_CONTRACT_NAME, module.Contract).pipe(
    // Same widening as compiled-contract.ts: the runtime-loaded module is
    // untyped, which collapses withWitnesses's inference to `never`.
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(evidenceZkConfigPath),
  );

  return { module, compiledContract };
}
