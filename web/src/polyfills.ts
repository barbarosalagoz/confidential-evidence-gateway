/**
 * Browser polyfills for Node globals that transitive dependencies reach for
 * without importing them.
 *
 * Known consumer: @subsquid/util-internal-hex (via the indexer public-data
 * provider) calls the bare global `Buffer.from` when decoding hex — it fires
 * during findDeployedContract's indexer queries, i.e. on "Join registry".
 * The `buffer` package is the standard browser implementation.
 *
 * This module must be the FIRST import of the entry point so it evaluates
 * before any dependency module body.
 */
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: { env: Record<string, string | undefined> } };

if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;
if (typeof g.process === 'undefined') g.process = { env: {} };

export {};
