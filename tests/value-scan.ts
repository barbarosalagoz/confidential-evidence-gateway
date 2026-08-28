/**
 * Deep scan helpers for the privacy tests.
 *
 * A privacy assertion is only worth anything if the scanner can actually find
 * the value when it IS present. Every "value is absent" test in this suite is
 * paired with a positive control that uses these same helpers to find the
 * value somewhere it is expected — otherwise the test would pass simply
 * because the scanner is broken.
 */

/** Reads a byte array as an unsigned integer, little-endian and big-endian. */
function bytesToBigInts(bytes: Uint8Array): bigint[] {
  let le = 0n;
  let be = 0n;
  for (let i = 0; i < bytes.length; i++) {
    le |= BigInt(bytes[i]) << BigInt(8 * i);
    be = (be << 8n) | BigInt(bytes[i]);
  }
  return [le, be];
}

/**
 * Walks any structure — plain objects, arrays, typed arrays, Maps, and the
 * runtime's WASM-backed objects — looking for `needle` in any encoding a
 * 64-bit unsigned integer could plausibly take: as a bigint, as a number, as
 * a decimal or hex string, or as raw bytes in either endianness.
 */
export function containsValue(node: unknown, needle: bigint, seen = new Set<unknown>()): boolean {
  if (node === null || node === undefined) return false;

  if (typeof node === 'bigint') return node === needle;
  if (typeof node === 'number') return Number.isInteger(node) && BigInt(node) === needle;

  if (typeof node === 'string') {
    if (node === needle.toString()) return true;
    const hex = needle.toString(16);
    const padded = hex.length % 2 === 0 ? hex : `0${hex}`;
    const lower = node.toLowerCase();
    return lower.includes(padded) || lower.includes(`0x${padded}`);
  }

  if (node instanceof Uint8Array) {
    if (bytesToBigInts(node).includes(needle)) return true;
    // Also scan every aligned sub-window: a Uint<64> may sit inside a wider
    // padded field rather than occupying the whole array.
    for (let start = 0; start < node.length; start++) {
      for (let len = 1; len <= 8 && start + len <= node.length; len++) {
        if (bytesToBigInts(node.subarray(start, start + len)).includes(needle)) return true;
      }
    }
    return false;
  }

  if (typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);

  if (Array.isArray(node)) {
    return node.some((v) => containsValue(v, needle, seen));
  }

  if (node instanceof Map) {
    for (const [k, v] of node) {
      if (containsValue(k, needle, seen) || containsValue(v, needle, seen)) return true;
    }
    return false;
  }

  if (node instanceof Set) {
    for (const v of node) if (containsValue(v, needle, seen)) return true;
    return false;
  }

  // Enumerate own + inherited accessors so WASM-backed objects (which expose
  // their data through getters on the prototype) are covered too.
  const keys = new Set<string>(Object.keys(node));
  let proto = Object.getPrototypeOf(node);
  while (proto && proto !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      const desc = Object.getOwnPropertyDescriptor(proto, k);
      if (desc?.get) keys.add(k);
    }
    proto = Object.getPrototypeOf(proto);
  }

  for (const key of keys) {
    let value: unknown;
    try {
      value = (node as Record<string, unknown>)[key];
    } catch {
      continue; // some WASM getters throw when the value is absent
    }
    if (typeof value === 'function') continue;
    if (containsValue(value, needle, seen)) return true;
  }

  return false;
}

/** Renders any structure to a string, for substring-level assertions. */
export function renderDeep(node: unknown): string {
  return JSON.stringify(node, (_k, v) => {
    if (typeof v === 'bigint') return `${v}n`;
    if (v instanceof Uint8Array) return Array.from(v);
    if (v && typeof v === 'object' && typeof (v as any).toString === 'function' && !Array.isArray(v)) {
      const s = Object.prototype.toString.call(v);
      if (s === '[object Object]') return v;
      try {
        return (v as any).toString();
      } catch {
        return v;
      }
    }
    return v;
  });
}
