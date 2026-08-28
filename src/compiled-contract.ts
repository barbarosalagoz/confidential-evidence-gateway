/**
 * Loads the compiled Compact artifacts and attaches the witness implementation.
 *
 * `contracts/managed/` is a build artifact (git-ignored, produced by
 * `npm run compile`), so it is not part of the TypeScript program and the
 * contract module is imported at runtime. Deploy, CLI and e2e-check all go
 * through here so the witness wiring exists in exactly one place.
 */
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { witnesses, CONTRACT_NAME, zkConfigPath, contractModulePath } from './compliance';

export interface LoadedContract {
  /** The generated module: `Contract`, `ledger()`, `pureCircuits`. */
  readonly module: any;
  /** Ready to hand to deployContract / findDeployedContract. */
  readonly compiledContract: any;
}

export function isCompiled(): boolean {
  return fs.existsSync(contractModulePath);
}

export async function loadCompiledContract(): Promise<LoadedContract> {
  if (!isCompiled()) {
    throw new Error(`Compiled contract missing at ${contractModulePath}. Run: npm run compile`);
  }

  const module = await import(pathToFileURL(contractModulePath).href);

  const compiledContract = CompiledContract.make(CONTRACT_NAME, module.Contract).pipe(
    // `module.Contract` arrives as `any` because the module is loaded at
    // runtime. That erases the type parameter `withWitnesses` infers its
    // argument from, collapsing it to `never` — hence the widening cast here.
    // The witness object itself is fully typed against the generated
    // signature in compliance.ts.
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );

  return { module, compiledContract };
}
