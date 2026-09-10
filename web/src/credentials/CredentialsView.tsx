/**
 * Level 3 view: Issuer · Holder · Verifier over the credentials registry.
 *
 * Issuer and Holder need a connected wallet (they submit transactions); the
 * Verifier needs nothing — it reads the public ledger from the indexer.
 */
import { useCallback, useEffect, useState } from 'react';
import { NETWORK_ID, defaultCredentialsDeployment } from '../config';
import type { WalletSession } from '../midnight/wallet';
import { buildProviders, DEFAULT_LOCAL_PROOF_SERVER, type ProvingMode } from '../midnight/providers';
import { describeError } from '../midnight/errors';
import { CredentialsApi, type CredentialRegistryState } from '../midnight/credentials-api';
import { fetchCredentialPublicState, type VerifierSnapshot } from '../midnight/auditor';
import { parseUint64, isoToEpochSeconds, type CredentialPrivateState } from '../../../src/credentials';

type Log = (text: string, kind?: 'info' | 'ok' | 'err') => void;

export function CredentialsView({ session, addLog }: { session: WalletSession | null; addLog: Log }) {
  const deployment = defaultCredentialsDeployment();
  const [contractAddress, setContractAddress] = useState(deployment?.contractAddress ?? '');
  const [provingMode, setProvingMode] = useState<ProvingMode>(() => {
    try {
      return (localStorage.getItem('evidence-gateway/proving-mode') as ProvingMode) || 'wallet';
    } catch {
      return 'wallet';
    }
  });
  const [proofServerUrl, setProofServerUrl] = useState(() => {
    try {
      return localStorage.getItem('evidence-gateway/proof-server-url') || DEFAULT_LOCAL_PROOF_SERVER;
    } catch {
      return DEFAULT_LOCAL_PROOF_SERVER;
    }
  });
  const [api, setApi] = useState<CredentialsApi | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState<CredentialPrivateState>({ credentials: {} });
  const [liveState, setLiveState] = useState<CredentialRegistryState | null>(null);

  // Issuer form
  const [issuerKeyInput, setIssuerKeyInput] = useState('');
  const [issuerPk, setIssuerPk] = useState<string | null>(null);
  const [credId, setCredId] = useState('7001');
  const [holderPkInput, setHolderPkInput] = useState('');
  const [typeId, setTypeId] = useState('1');
  const [expiry, setExpiry] = useState(() => new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10));
  const [content, setContent] = useState('');
  const [handover, setHandover] = useState<{ credentialId: string; saltHex: string; content: string } | null>(null);

  // Holder form
  const [holderPk, setHolderPk] = useState<string | null>(null);
  const [hCredId, setHCredId] = useState('7001');
  const [hContent, setHContent] = useState('');
  const [hSalt, setHSalt] = useState('');

  // Verifier
  const [verifierAddress, setVerifierAddress] = useState(deployment?.contractAddress ?? '');
  const [snapshot, setSnapshot] = useState<VerifierSnapshot | null>(null);
  const [verifierError, setVerifierError] = useState<string | null>(null);
  const [verifierBusy, setVerifierBusy] = useState(false);

  const refreshLocal = useCallback(async (current: CredentialsApi) => setLocal(await current.localState()), []);

  // Drop the joined contract when the wallet disconnects.
  useEffect(() => {
    if (!session) {
      setApi(null);
      setLiveState(null);
    }
  }, [session]);

  useEffect(() => {
    if (!api) return;
    return api.watchPublicState(
      (state) => setLiveState(state),
      (err) => addLog(`Credential-state watch error: ${err.message}`, 'err'),
    );
  }, [api, addLog]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      // Full cause chain + hint: the SDK wraps wallet/prover failures in a
      // generic "scoped transaction" error whose inner message may be empty.
      describeError(err, label).forEach((line, i) => addLog(line, i === 0 ? 'err' : 'info'));
      console.error(`[${label}]`, err);
    } finally {
      setBusy(null);
    }
  };

  const join = () =>
    run('join', async () => {
      if (!session) throw new Error('Connect the wallet first.');
      const address = contractAddress.trim();
      if (!address) throw new Error('Enter the credentials registry address.');
      addLog(`Building providers for the credentials registry (proving mode: ${provingMode === 'wallet' ? 'Lace-delegated' : `app → ${proofServerUrl}`})...`);
      try {
        localStorage.setItem('evidence-gateway/proving-mode', provingMode);
        localStorage.setItem('evidence-gateway/proof-server-url', proofServerUrl);
      } catch {
        /* per-viewer convenience only */
      }
      // Separate providers instance: private-state scope must not be shared
      // with the Level 2 evidence contract.
      const providers = await buildProviders(session.api, NETWORK_ID, addLog, {
        mode: provingMode,
        proofServerUrl,
      });
      const joined = await CredentialsApi.join(providers, address, NETWORK_ID);
      setApi(joined);
      const state = await joined.localState();
      setLocal(state);
      if (state.issuerSecretKeyHex) setIssuerPk(await joined.importIssuerKey(state.issuerSecretKeyHex));
      addLog(`Joined credentials registry ${address.slice(0, 20)}…`, 'ok');
    });

  const importIssuer = () =>
    run('issuer-key', async () => {
      if (!api) return;
      const pk = await api.importIssuerKey(issuerKeyInput);
      setIssuerPk(pk);
      setIssuerKeyInput('');
      await refreshLocal(api);
      addLog(`Issuer key imported (kept in localStorage). Derived pk ${pk.slice(0, 16)}…`, 'ok');
    });

  const issue = () =>
    run('issue', async () => {
      if (!api) return;
      const id = parseUint64(credId, 'credential id');
      if (!content.trim()) throw new Error('Credential content is empty.');
      const exp = isoToEpochSeconds(`${expiry}T23:59:59Z`);
      addLog(`issueCredential(${id}, type ${typeId}, expiry ${expiry}) — proving as issuer…`);
      const { receipt, handover: h } = await api.issueCredential(
        id,
        holderPkInput,
        parseUint64(typeId, 'type id'),
        exp,
        content,
      );
      addLog(`issueCredential confirmed — tx ${receipt.txHash} (block ${receipt.blockHeight})`, 'ok');
      addLog('On-chain: type, expiry, opaque commitment. Content, score and holder identity stayed local.');
      setHandover({ credentialId: id.toString(), saltHex: h.saltHex, content: h.content });
      setContent('');
      await refreshLocal(api);
    });

  const revoke = () =>
    run('revoke', async () => {
      if (!api) return;
      const id = parseUint64(credId, 'credential id');
      addLog(`revokeCredential(${id}) — proving as issuer…`);
      const receipt = await api.revokeCredential(id);
      addLog(`revokeCredential confirmed — tx ${receipt.txHash} (block ${receipt.blockHeight})`, 'ok');
    });

  const ensureHolder = () =>
    run('holder-key', async () => {
      if (!api) return;
      const pk = await api.ensureHolderKey();
      setHolderPk(pk);
      await refreshLocal(api);
      addLog(`Holder key ready. Public key (give this to the issuer): ${pk.slice(0, 16)}…`, 'ok');
    });

  const importMaterial = () =>
    run('material', async () => {
      if (!api) return;
      const id = parseUint64(hCredId, 'credential id');
      if (!hContent.trim() || !hSalt.trim()) throw new Error('Paste both the credential content and the salt from the issuer.');
      await api.importCredentialMaterial(id, hContent, hSalt);
      await refreshLocal(api);
      addLog(`Credential ${id} material stored locally (digest + salt + content).`, 'ok');
      await diagnoseCredential(id);
    });

  /** Pre-flight: compare what this browser would commit to with the chain. */
  const diagnoseCredential = async (id: bigint) => {
    if (!api) return;
    const row = (liveState ?? snapshot?.state)?.rows.find((r) => r.credentialId === id);
    const d = await api.diagnose(id, row?.commitmentHex ?? null);
    addLog(`pre-flight ${id}: holder pk ${d.holderPkHex ? d.holderPkHex.slice(0, 16) + '…' : 'MISSING'} · digest ${d.digestHex ? d.digestHex.slice(0, 16) + '…' : 'MISSING'} · salt ${d.saltHex ? d.saltHex.slice(0, 16) + '…' : 'MISSING'}`);
    if (d.localCommitmentHex && d.onChainCommitmentHex) {
      addLog(
        `pre-flight ${id}: local commitment ${d.localCommitmentHex.slice(0, 16)}… vs on-chain ${d.onChainCommitmentHex.slice(0, 16)}… → ${d.matches ? 'MATCH — proof will pass the holder check' : 'MISMATCH — proof would fail; check that the issuer used this exact holder pk, and that content/salt are byte-identical'}`,
        d.matches ? 'ok' : 'err',
      );
    } else if (!d.onChainCommitmentHex) {
      addLog(`pre-flight ${id}: no on-chain commitment visible yet — read public state and retry.`);
    }
  };

  const prove = () =>
    run('prove', async () => {
      if (!api) return;
      const id = parseUint64(hCredId, 'credential id');
      await diagnoseCredential(id);
      addLog(`proveCredential(${id}) — proving: not revoked, not expired at block time, I am the holder…`);
      const receipt = await api.proveCredential(id);
      addLog(`proveCredential confirmed — tx ${receipt.txHash} (block ${receipt.blockHeight})`, 'ok');
      addLog(`Credential ${id} is publicly VALID — score and holder never shown.`);
    });

  const verify = async () => {
    const address = verifierAddress.trim();
    if (!address) return;
    setVerifierBusy(true);
    setVerifierError(null);
    try {
      setSnapshot(await fetchCredentialPublicState(address));
    } catch (err) {
      setSnapshot(null);
      setVerifierError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifierBusy(false);
    }
  };

  const spinner = (label: string, text: string) => (busy === label ? <><span className="spinner" />Proving…</> : text);
  const localIds = Object.keys(local.credentials);

  return (
    <>
      {!api && (
        <section className="panel" style={{ marginBottom: 18 }}>
          <h2><span className={`status-dot ${session ? 'on' : 'off'}`} />Credentials registry</h2>
          <p className="sub">Issuer and Holder actions need the connected wallet; the Verifier does not.</p>
          <label>Deployed credentials registry address ({NETWORK_ID})</label>
          <input type="text" value={contractAddress} onChange={(e) => setContractAddress(e.target.value)} placeholder="contract address…" />
          <label style={{ marginTop: 10 }}>Proving mode</label>
          <div className="row" style={{ gap: 16 }}>
            <label style={{ margin: 0, color: 'var(--text)' }}>
              <input type="radio" name="proving" checked={provingMode === 'wallet'} onChange={() => setProvingMode('wallet')} />{' '}
              Lace-delegated (Lace uses its own proof-server setting)
            </label>
            <label style={{ margin: 0, color: 'var(--text)' }}>
              <input type="radio" name="proving" checked={provingMode === 'proof-server'} onChange={() => setProvingMode('proof-server')} />{' '}
              App → proof server directly
            </label>
          </div>
          {provingMode === 'proof-server' && (
            <>
              <label style={{ marginTop: 6 }}>Proof server URL (local container: {DEFAULT_LOCAL_PROOF_SERVER})</label>
              <input type="text" value={proofServerUrl} onChange={(e) => setProofServerUrl(e.target.value)} />
            </>
          )}
          <div className="row">
            <button onClick={join} disabled={!session || busy !== null}>
              {busy === 'join' ? <><span className="spinner" />Joining…</> : session ? 'Join registry' : 'Connect wallet to join'}
            </button>
          </div>
        </section>
      )}

      <div className="columns three">
        {/* ── Issuer ─────────────────────────────────────────────── */}
        <section className="panel">
          <h2><span className={`status-dot ${issuerPk ? 'on' : 'off'}`} />Issuer</h2>
          <p className="sub">Registers and revokes credentials. Authority = knowing the issuer secret key.</p>
          {api && !issuerPk && (
            <>
              <label>Issuer secret key (from the deploy's key file)</label>
              <input type="text" value={issuerKeyInput} onChange={(e) => setIssuerKeyInput(e.target.value)} placeholder="64 hex chars" />
              <div className="row"><button className="secondary" onClick={importIssuer} disabled={busy !== null}>Import issuer key</button></div>
            </>
          )}
          {api && issuerPk && (
            <>
              <div className="note">Issuer pk <span className="addr">{issuerPk}</span></div>
              <label>Credential ID (public)</label>
              <input type="text" value={credId} onChange={(e) => setCredId(e.target.value)} />
              <label style={{ marginTop: 8 }}>Holder public key (bound inside the commitment — not published)</label>
              <input type="text" value={holderPkInput} onChange={(e) => setHolderPkInput(e.target.value)} placeholder="64 hex chars from the holder" />
              <div className="row" style={{ gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ marginTop: 8 }}>Type ID (public)</label>
                  <input type="text" value={typeId} onChange={(e) => setTypeId(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ marginTop: 8 }}>Expiry (public, UTC end of day)</label>
                  <input type="text" value={expiry} onChange={(e) => setExpiry(e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
              </div>
              <label style={{ marginTop: 8 }}>Credential content (PRIVATE — e.g. the score)</label>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="SOC2 Type II — audit 2026-Q3 — composite score 92/100" />
              <div className="row">
                <button onClick={issue} disabled={busy !== null}>{spinner('issue', 'Issue credential')}</button>
                <button className="secondary" onClick={revoke} disabled={busy !== null}>{spinner('revoke', 'Revoke credential')}</button>
              </div>
              {handover && (
                <div className="note">
                  Hand to the holder out-of-band for credential {handover.credentialId}:<br />
                  content: <span className="addr">{handover.content}</span><br />
                  salt: <span className="addr">{handover.saltHex}</span>
                </div>
              )}
            </>
          )}
          {!api && <p className="sub">Join the registry to act as issuer.</p>}
        </section>

        {/* ── Holder ─────────────────────────────────────────────── */}
        <section className="panel">
          <h2><span className={`status-dot ${holderPk ? 'on' : 'off'}`} />Holder</h2>
          <p className="sub">Proves a credential is valid, unrevoked and unexpired — without revealing it.</p>
          {api ? (
            <>
              {!holderPk ? (
                <div className="row"><button className="secondary" onClick={ensureHolder} disabled={busy !== null}>Create / load holder key</button></div>
              ) : (
                <div className="note">Holder pk (share with issuer) <span className="addr">{holderPk}</span></div>
              )}
              <label>Credential ID</label>
              <input type="text" value={hCredId} onChange={(e) => setHCredId(e.target.value)} />
              <label style={{ marginTop: 8 }}>Credential content (from issuer, PRIVATE)</label>
              <textarea value={hContent} onChange={(e) => setHContent(e.target.value)} />
              <label style={{ marginTop: 8 }}>Salt (from issuer, PRIVATE)</label>
              <input type="text" value={hSalt} onChange={(e) => setHSalt(e.target.value)} placeholder="64 hex chars" />
              <div className="row">
                <button className="secondary" onClick={importMaterial} disabled={busy !== null}>Store material</button>
                <button className="secondary" onClick={() => run('diagnose', () => diagnoseCredential(parseUint64(hCredId, 'credential id')))} disabled={busy !== null}>Pre-flight check</button>
                <button onClick={prove} disabled={busy !== null || !holderPk}>{spinner('prove', 'Prove credential')}</button>
              </div>
              {localIds.length > 0 && (
                <>
                  <label style={{ marginTop: 12 }}>Local private material (this browser only, unencrypted)</label>
                  <table className="table">
                    <thead><tr><th>Credential</th><th>Held locally</th></tr></thead>
                    <tbody>
                      {localIds.map((id) => (
                        <tr key={id}>
                          <td>{id}</td>
                          <td><span className="pill local">digest + salt{local.credentials[id].content ? ' + content' : ''}{local.credentials[id].holderPkHex ? ' + holder pk' : ''}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          ) : (
            <p className="sub">Join the registry to act as holder.</p>
          )}
        </section>

        {/* ── Verifier ───────────────────────────────────────────── */}
        <section className="panel">
          <h2><span className="status-dot on" />Verifier</h2>
          <p className="sub">Public state only — no wallet. Status is derived from revoked/expiry/verified plus this clock.</p>
          <label>Credentials registry address</label>
          <input type="text" value={verifierAddress} onChange={(e) => setVerifierAddress(e.target.value)} placeholder="contract address…" />
          <div className="row">
            <button onClick={verify} disabled={verifierBusy || !verifierAddress.trim()}>
              {verifierBusy ? <><span className="spinner" />Reading chain…</> : 'Read public state'}
            </button>
          </div>
          {verifierError && <div className="note" style={{ borderLeftColor: 'var(--err)' }}>{verifierError}</div>}
          {snapshot && (
            <>
              <div className="note">
                Latest action: tx <span className="addr">{snapshot.txHash}</span>
                {snapshot.blockHeight !== null && <> · block {snapshot.blockHeight}</>}
              </div>
              <CredentialTable state={snapshot.state} />
            </>
          )}
          {!snapshot && liveState && (
            <>
              <div className="note">Live view via wallet-side indexer subscription.</div>
              <CredentialTable state={liveState} />
            </>
          )}
        </section>
      </div>
    </>
  );
}

function CredentialTable({ state }: { state: CredentialRegistryState }) {
  const pill = (status: string) => {
    switch (status) {
      case 'valid': return <span className="pill verified">✓ valid — proven</span>;
      case 'revoked': return <span className="pill revoked">revoked</span>;
      case 'expired': return <span className="pill revoked">expired</span>;
      default: return <span className="pill registered">issued, unproven</span>;
    }
  };
  return (
    <>
      <div className="sub">Issuer pk <span className="addr">{state.issuerPkHex}</span></div>
      <table className="table">
        <thead><tr><th>ID</th><th>Type</th><th>Expiry (UTC)</th><th>Commitment</th><th>Status</th></tr></thead>
        <tbody>
          {state.rows.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>Registry is empty.</td></tr>}
          {state.rows.map((row) => (
            <tr key={row.credentialId.toString()}>
              <td>{row.credentialId.toString()}</td>
              <td>{row.typeId.toString()}</td>
              <td>{new Date(Number(row.expirySeconds) * 1000).toISOString().slice(0, 10)}</td>
              <td className="commitment">{row.commitmentHex.slice(0, 16)}…</td>
              <td>{pill(row.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub" style={{ marginTop: 8 }}>
        Total valid proofs: {state.totalProofs.toString()}. Not on-chain: content, score, holder identity.
      </p>
    </>
  );
}
