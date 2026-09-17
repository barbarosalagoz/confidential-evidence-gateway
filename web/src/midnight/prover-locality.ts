/**
 * Whether a proof-server URL points at this machine. Proving hands the
 * witnesses (digest, salt, the secret keys' circuit inputs) to whichever
 * prover is used, so the app warns when that is not localhost. Kept free of
 * SDK imports so it is testable in plain Node.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function isLocalProverUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url.trim());
    return LOCAL_HOSTS.has(hostname.toLowerCase()) || hostname.toLowerCase().endsWith('.localhost');
  } catch {
    return false;
  }
}

/** Where proofs are produced for this session, as far as the app can tell. */
export type ProverInfo = {
  mode: 'wallet' | 'proof-server';
  /** The proof-server URL in use, or what Lace reported; null when Lace reported none. */
  url: string | null;
  /** null when the URL is unknown (Lace-delegated with nothing advertised). */
  local: boolean | null;
};

export const proverInfo = (mode: ProverInfo['mode'], url: string | null | undefined): ProverInfo => {
  const trimmed = url?.trim() || null;
  return { mode, url: trimmed, local: trimmed ? isLocalProverUrl(trimmed) : null };
};

/** The one-line warning shown when proving is not known to be local; null when it is. */
export function remoteProverWarning(info: ProverInfo): string | null {
  if (info.local === true) return null;
  const witnesses = 'the prover receives the witnesses (digest, salt and the secret keys’ circuit inputs)';
  if (info.url === null) {
    return `Proving is delegated to Lace, which did not report its proof server — if it is remote, ${witnesses}. Use a local proof server when witness confidentiality matters.`;
  }
  const via = info.mode === 'wallet' ? `Lace’s configured proof server ${info.url}` : `proof server ${info.url}`;
  return `Proving is remote via ${via}: ${witnesses}. Use a local proof server (${'http://localhost:6300'}) when witness confidentiality matters.`;
}
