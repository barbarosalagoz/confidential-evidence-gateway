import { describe, it, expect } from 'vitest';
import { isLocalProverUrl, proverInfo, remoteProverWarning } from './prover-locality';

describe('isLocalProverUrl', () => {
  it('accepts loopback forms', () => {
    for (const u of ['http://localhost:6300', 'http://127.0.0.1:6300', 'http://[::1]:6300', 'https://LOCALHOST', 'http://dev.localhost:6300']) {
      expect(isLocalProverUrl(u), u).toBe(true);
    }
  });
  it('rejects anything else, including unparsable input', () => {
    for (const u of ['https://lace-proof-server.midnight.network', 'http://192.168.1.10:6300', 'http://localhost.example.com', 'not a url', '']) {
      expect(isLocalProverUrl(u), u).toBe(false);
    }
  });
});

describe('remoteProverWarning', () => {
  it('is silent for a local prover', () => {
    expect(remoteProverWarning(proverInfo('proof-server', 'http://localhost:6300'))).toBeNull();
    expect(remoteProverWarning(proverInfo('wallet', 'http://127.0.0.1:6300'))).toBeNull();
  });
  it('names a remote proof server and what it sees', () => {
    const w = remoteProverWarning(proverInfo('wallet', 'https://prover.example.net'));
    expect(w).toContain('Lace’s configured proof server https://prover.example.net');
    expect(w).toContain('witnesses');
    expect(w).toContain('local proof server');
  });
  it('warns when Lace reports no proof server at all', () => {
    const info = proverInfo('wallet', undefined);
    expect(info.local).toBeNull();
    expect(remoteProverWarning(info)).toContain('did not report its proof server');
  });
});
