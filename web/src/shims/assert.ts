// Minimal browser shim for Node's `assert`, used by transitive dependencies
// of the indexer provider (@subsquid/scale-codec).
function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}
namespace assert {
  export function ok(condition: unknown, message?: string): asserts condition {
    if (!condition) throw new Error(message ?? 'Assertion failed');
  }
  export function strictEqual(actual: unknown, expected: unknown, message?: string): void {
    if (actual !== expected) throw new Error(message ?? `Expected ${String(actual)} === ${String(expected)}`);
  }
  export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void {
    if (actual === expected) throw new Error(message ?? `Expected values to differ`);
  }
  export function fail(message?: string): never {
    throw new Error(message ?? 'Assertion failed');
  }
}
export default assert;
export const ok = assert.ok;
export const strictEqual = assert.strictEqual;
export const notStrictEqual = assert.notStrictEqual;
export const fail = assert.fail;
