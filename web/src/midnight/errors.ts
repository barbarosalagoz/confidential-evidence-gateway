/**
 * Turns the nested errors thrown by Midnight.js / the DApp connector into
 * something a person can act on: every layer of the `cause` chain, any HTTP
 * response details, and a hint for the failure signatures we have seen.
 */

export type ErrorLayer = {
  name: string;
  message: string;
  status?: number;
  statusText?: string;
  body?: string;
  code?: string;
};

const MAX_DEPTH = 8;

function pick(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

function asString(v: unknown, max = 400): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === 'string' ? v : safeJson(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? `${val}n` : val));
  } catch {
    return String(v);
  }
}

/** Flattens err → err.cause → err.cause.cause … into layers (outermost first). */
export function errorLayers(err: unknown): ErrorLayer[] {
  const layers: ErrorLayer[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < MAX_DEPTH && current !== undefined && current !== null && !seen.has(current); depth++) {
    seen.add(current);
    const name = String(pick(current, 'name') ?? (current instanceof Error ? current.constructor.name : typeof current));
    const message =
      typeof current === 'string'
        ? current
        : String(pick(current, 'message') ?? pick(current, 'reason') ?? pick(current, 'error') ?? '') ||
          (current instanceof Error ? '' : safeJson(current));
    const response = pick(current, 'response');
    const layer: ErrorLayer = { name, message };
    const status = pick(current, 'status') ?? pick(response, 'status') ?? pick(current, 'statusCode');
    if (typeof status === 'number') layer.status = status;
    const statusText = pick(current, 'statusText') ?? pick(response, 'statusText');
    if (typeof statusText === 'string') layer.statusText = statusText;
    const body = pick(current, 'body') ?? pick(response, 'body') ?? pick(current, 'data') ?? pick(current, 'details');
    const bodyStr = asString(body);
    if (bodyStr) layer.body = bodyStr;
    const code = pick(current, 'code') ?? pick(current, 'info');
    if (code !== undefined && code !== null) layer.code = asString(code, 120);
    layers.push(layer);
    // AggregateError / Effect-style errors carry the real failure in `errors`.
    const errors = pick(current, 'errors');
    current = pick(current, 'cause') ?? (Array.isArray(errors) ? errors[0] : undefined);
  }
  return layers;
}

/** Actionable hints for failure signatures observed against Lace + Preprod. */
export function errorHint(layers: ErrorLayer[]): string | null {
  const text = layers.map((l) => `${l.name} ${l.message} ${l.body ?? ''} ${l.code ?? ''}`).join(' | ');
  if (
    /message channel closed|Extension context invalidated|Receiving end does not exist|disconnected port/i.test(text) ||
    /proving failed after [\d.]+s: \(empty error from the wallet\/prover\)/.test(text)
  ) {
    return (
      'The Lace extension\'s message channel closed before it answered — typically a long remote proving ' +
      'round-trip outliving the connector call. Retry; if it repeats, set Lace\'s proof server to Local ' +
      '(http://localhost:6300 with the proof-server container running), or use the proof-server fallback.'
    );
  }
  if (/Not enough Dust|Insufficient Funds|could not balance dust|insufficient.*dust/i.test(text)) {
    return 'Wallet could not balance the fee: not enough generated tDUST yet. Wait for DUST to accrue (or fund with more tNIGHT) and retry.';
  }
  if (/Failed to fetch|NetworkError|ECONNREFUSED|ERR_CONNECTION|Load failed/i.test(text)) {
    return 'A network request failed (proof server / indexer). Check the proof-server URL in Lace, that the container is up on :6300, and CORS.';
  }
  if (/user rejected|rejected by user|denied|cancel/i.test(text)) {
    return 'The wallet rejected or the user cancelled the request in Lace.';
  }
  if (/failed assert:/i.test(text)) {
    return 'The circuit\'s own assertion failed during local execution — no transaction was produced.';
  }
  if (/RuntimeError: unreachable|\bunreachable\b/i.test(text)) {
    return 'The ledger WASM panicked ("unreachable") inside the proving path — the prover returned something the ledger could not use. Retry; if it repeats, switch proving mode (Lace-delegated ↔ app → proof server).';
  }
  if (/timeout|timed out/i.test(text)) {
    return 'An operation timed out — remote proving can take 20–60 s for these circuits; try again or switch to a Local proof server.';
  }
  return null;
}

/**
 * Rejects if `work` has not settled within `ms`. A WASM panic ("unreachable")
 * inside the ledger's proving path, or an extension channel that drops
 * without replying, leaves the promise pending forever — this is the only
 * way the UI ever learns about it.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${what} timed out after ${Math.round(ms / 1000)}s — no response from the wallet/prover ` +
              '(a dropped extension channel or a prover-side crash never settles; see the browser console for "unreachable" or "message channel closed").',
          ),
        ),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** Formats a window `error` / `unhandledrejection` event for the activity log. */
export function describeWindowEvent(ev: ErrorEvent | PromiseRejectionEvent): string {
  const reason = 'reason' in ev ? ev.reason : ev.error ?? ev.message;
  const layers = errorLayers(reason);
  const head = layers[0];
  const text = head ? `${head.name}: ${head.message || '(no message)'}` : String(reason);
  const hint = errorHint(layers);
  return `[browser ${'reason' in ev ? 'unhandled rejection' : 'uncaught error'}] ${text}${hint ? ` — hint: ${hint}` : ''}`;
}

/** Multi-line, human-readable rendering for the activity log. */
export function describeError(err: unknown, stage?: string): string[] {
  const layers = errorLayers(err);
  const lines: string[] = [];
  const head = layers[0];
  lines.push(`${stage ? `[${stage}] ` : ''}${head?.name ?? 'Error'}: ${head?.message || '(no message)'}`);
  layers.slice(1).forEach((l, i) => {
    const extras = [
      l.status !== undefined ? `HTTP ${l.status}${l.statusText ? ` ${l.statusText}` : ''}` : null,
      l.code ? `code=${l.code}` : null,
      l.body ? `body=${l.body}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`  cause ${i + 1}: ${l.name}: ${l.message || '(no message)'}${extras ? ` — ${extras}` : ''}`);
  });
  if (head && (head.status !== undefined || head.body || head.code)) {
    lines.push(`  detail: ${[head.status !== undefined ? `HTTP ${head.status}` : null, head.code ? `code=${head.code}` : null, head.body ? `body=${head.body}` : null].filter(Boolean).join(' ')}`);
  }
  const hint = errorHint(layers);
  if (hint) lines.push(`  hint: ${hint}`);
  return lines;
}
