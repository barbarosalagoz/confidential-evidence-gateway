import { describe, it, expect } from 'vitest';
import { describeError, errorLayers, errorHint } from './errors';

describe('describeError — unwraps SDK / wallet errors', () => {
  it('renders every cause layer, including an empty inner message (the Lace channel-drop case)', () => {
    const inner = new Error(''); // what the connector returned
    const staged = new Error('proving failed after 20.3s: (empty error from the wallet/prover)', { cause: inner });
    const sdk = new Error("Unexpected error submitting scoped transaction '<unnamed>': Error", { cause: staged });
    const lines = describeError(sdk, 'prove');
    expect(lines[0]).toContain("[prove] Error: Unexpected error submitting scoped transaction");
    expect(lines[1]).toContain('cause 1: Error: proving failed after 20.3s');
    expect(lines[2]).toContain('cause 2: Error: (no message)');
  });

  it('surfaces HTTP status and body from a prover/indexer response', () => {
    const httpErr = Object.assign(new Error('Request failed'), { status: 500, statusText: 'Internal Server Error', body: '{"error":"proof generation failed"}' });
    const wrapped = new Error('proving failed after 3.1s: Request failed', { cause: httpErr });
    const lines = describeError(wrapped, 'prove');
    expect(lines.join('\n')).toContain('HTTP 500 Internal Server Error');
    expect(lines.join('\n')).toContain('body={"error":"proof generation failed"}');
  });

  it('gives the Lace message-channel hint', () => {
    const err = new Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received');
    expect(errorHint(errorLayers(err))).toMatch(/Lace extension.*message channel/);
  });

  it('distinguishes dust shortage, network failure and user rejection', () => {
    expect(errorHint(errorLayers(new Error('Not enough Dust to cover fees')))).toMatch(/tDUST/);
    expect(errorHint(errorLayers(new TypeError('Failed to fetch')))).toMatch(/network request failed/);
    expect(errorHint(errorLayers(new Error('User rejected the request')))).toMatch(/rejected/);
    expect(errorHint(errorLayers(new Error('failed assert: credential revoked')))).toMatch(/assertion failed/);
  });

  it('handles non-Error throwables and cycles without blowing up', () => {
    const a: any = new Error('a');
    const b: any = new Error('b', { cause: a });
    a.cause = b; // cycle
    expect(errorLayers(b).length).toBeLessThanOrEqual(8);
    expect(describeError('plain string')[0]).toContain('plain string');
    expect(describeError({ reason: 'object-shaped' })[0]).toContain('object-shaped');
  });
});
