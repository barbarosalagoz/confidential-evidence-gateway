import { useCallback, useEffect, useRef, useState } from 'react';
import { NETWORK_ID, defaultDeployment } from './config';
import { connectWallet, type WalletSession } from './midnight/wallet';
import { buildProviders } from './midnight/providers';
import { EvidenceApi, type PublicRegistryState } from './midnight/evidence-api';
import { fetchPublicState, type AuditorSnapshot } from './midnight/auditor';
import { parseControlId, type EvidencePrivateState } from '../../src/evidence';

type LogEntry = { at: Date; text: string; kind: 'info' | 'ok' | 'err' };

export default function App() {
  const deployment = defaultDeployment();

  const [session, setSession] = useState<WalletSession | null>(null);
  const [api, setApi] = useState<EvidenceApi | null>(null);
  const [contractAddress, setContractAddress] = useState(deployment?.contractAddress ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [publicState, setPublicState] = useState<PublicRegistryState | null>(null);
  const [localState, setLocalState] = useState<EvidencePrivateState>({ records: {} });

  const [controlId, setControlId] = useState('1001');
  const [content, setContent] = useState('');

  const [auditorAddress, setAuditorAddress] = useState(deployment?.contractAddress ?? '');
  const [auditor, setAuditor] = useState<AuditorSnapshot | null>(null);
  const [auditorError, setAuditorError] = useState<string | null>(null);
  const [auditorBusy, setAuditorBusy] = useState(false);

  const logEnd = useRef<HTMLDivElement>(null);

  const addLog = useCallback((text: string, kind: LogEntry['kind'] = 'info') => {
    setLog((entries) => [...entries.slice(-199), { at: new Date(), text, kind }]);
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const refreshLocal = useCallback(async (current: EvidenceApi) => {
    setLocalState(await current.localRecords());
  }, []);

  const handleConnect = async () => {
    setBusy('connect');
    try {
      addLog(`Looking for a Midnight wallet (network: ${NETWORK_ID})...`);
      const nextSession = await connectWallet(NETWORK_ID);
      setSession(nextSession);
      addLog(`Connected to ${nextSession.walletName} — ${nextSession.unshieldedAddress.slice(0, 24)}…`, 'ok');
    } catch (err) {
      addLog(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = () => {
    setSession(null);
    setApi(null);
    setPublicState(null);
    addLog('Disconnected. (Lace keeps its own authorization; revoke it in the wallet if desired.)');
  };

  const handleJoin = async () => {
    if (!session) return;
    const address = contractAddress.trim();
    if (!address) {
      addLog('Enter the deployed contract address first.', 'err');
      return;
    }
    setBusy('join');
    try {
      addLog('Building providers from wallet configuration...');
      const providers = await buildProviders(session.api, NETWORK_ID, addLog);
      addLog(`Joining registry at ${address.slice(0, 20)}…`);
      const joined = await EvidenceApi.join(providers, address, NETWORK_ID);
      setApi(joined);
      await refreshLocal(joined);
      addLog('Joined. Watching public ledger state via the indexer.', 'ok');
    } catch (err) {
      addLog(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setBusy(null);
    }
  };

  // Live public-state subscription once joined.
  useEffect(() => {
    if (!api) return;
    const stop = api.watchPublicState(
      (state) => setPublicState(state),
      (err) => addLog(`Public-state watch error: ${err.message}`, 'err'),
    );
    return stop;
  }, [api, addLog]);

  const runCircuit = async (which: 'register' | 'prove') => {
    if (!api) return;
    let id: bigint;
    try {
      id = parseControlId(controlId);
    } catch (err) {
      addLog(err instanceof Error ? err.message : String(err), 'err');
      return;
    }
    setBusy(which);
    try {
      if (which === 'register') {
        if (!content.trim()) {
          addLog('Evidence content is empty — enter the confidential record text.', 'err');
          setBusy(null);
          return;
        }
        addLog(`registerEvidence(${id}): hashing locally, proving, submitting…`);
        const receipt = await api.registerEvidence(id, content);
        addLog(`registerEvidence confirmed — tx ${receipt.txHash} (block ${receipt.blockHeight})`, 'ok');
        addLog('On-chain: only the opaque commitment. The record stayed in this browser.');
        setContent('');
      } else {
        addLog(`proveEvidence(${id}): proving knowledge of the committed record…`);
        const receipt = await api.proveEvidence(id);
        addLog(`proveEvidence confirmed — tx ${receipt.txHash} (block ${receipt.blockHeight})`, 'ok');
        addLog(`Control ${id} is now publicly VERIFIED — its contents were never shown.`);
      }
      await refreshLocal(api);
    } catch (err) {
      addLog(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setBusy(null);
    }
  };

  const runAudit = async () => {
    const address = auditorAddress.trim();
    if (!address) return;
    setAuditorBusy(true);
    setAuditorError(null);
    try {
      setAuditor(await fetchPublicState(address));
    } catch (err) {
      setAuditor(null);
      setAuditorError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuditorBusy(false);
    }
  };

  const localIds = Object.keys(localState.records);

  return (
    <div className="app">
      <header className="masthead">
        <h1><span className="moon">🌒</span>Confidential Evidence Gateway</h1>
        <span className="badge">Midnight {NETWORK_ID} · Level 2</span>
      </header>
      <p className="tagline">
        Prove that a valid compliance-evidence record exists for a control — without revealing the
        record. The chain holds an opaque commitment and a verified flag; the evidence never leaves
        this browser.
      </p>

      <div className="columns">
        {/* ── Evidence holder ──────────────────────────────────────── */}
        <section className="panel">
          <h2>
            <span className={`status-dot ${session ? 'on' : 'off'}`} />
            Evidence holder
          </h2>
          <p className="sub">Connect Lace, join the registry, register and prove evidence.</p>

          {!session ? (
            <button onClick={handleConnect} disabled={busy !== null}>
              {busy === 'connect' ? <><span className="spinner" />Connecting…</> : 'Connect Lace wallet'}
            </button>
          ) : (
            <>
              <div className="row">
                <span className="addr">{session.unshieldedAddress}</span>
              </div>
              <div className="row">
                <button className="secondary" onClick={handleDisconnect}>Disconnect</button>
              </div>

              {!api ? (
                <>
                  <label>Deployed registry address ({NETWORK_ID})</label>
                  <input
                    type="text"
                    value={contractAddress}
                    onChange={(e) => setContractAddress(e.target.value)}
                    placeholder="contract address…"
                  />
                  <div className="row">
                    <button onClick={handleJoin} disabled={busy !== null}>
                      {busy === 'join' ? <><span className="spinner" />Joining…</> : 'Join registry'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="note">
                    Joined <span className="addr">{api.contractAddress}</span>
                  </div>

                  <label>Control ID (public)</label>
                  <input type="text" value={controlId} onChange={(e) => setControlId(e.target.value)} />

                  <label style={{ marginTop: 10 }}>Evidence record (PRIVATE — never transmitted)</label>
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="e.g. SOC2 CC6.1 access-control review 2026-Q3: PASSED (audit ref #4471)"
                  />

                  <div className="row">
                    <button onClick={() => runCircuit('register')} disabled={busy !== null}>
                      {busy === 'register' ? <><span className="spinner" />Proving…</> : 'Register evidence'}
                    </button>
                    <button className="secondary" onClick={() => runCircuit('prove')} disabled={busy !== null}>
                      {busy === 'prove' ? <><span className="spinner" />Proving…</> : 'Prove evidence'}
                    </button>
                  </div>

                  {localIds.length > 0 && (
                    <>
                      <label style={{ marginTop: 12 }}>Local private records (this browser only)</label>
                      <table className="table">
                        <thead>
                          <tr><th>Control</th><th>Where it lives</th></tr>
                        </thead>
                        <tbody>
                          {localIds.map((id) => (
                            <tr key={id}>
                              <td>{id}</td>
                              <td><span className="pill local">localStorage — digest + salt{localState.records[id].content ? ' + content' : ''}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}
            </>
          )}

          <label style={{ marginTop: 14 }}>Activity</label>
          <div className="log">
            {log.length === 0 && <div>— quiet so far —</div>}
            {log.map((entry, i) => (
              <div key={i} className={entry.kind === 'err' ? 'err' : entry.kind === 'ok' ? 'ok' : ''}>
                <time>{entry.at.toLocaleTimeString()}</time>
                {entry.text}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
        </section>

        {/* ── Auditor ─────────────────────────────────────────────── */}
        <section className="panel">
          <h2><span className="status-dot on" />Auditor view</h2>
          <p className="sub">
            No wallet, no connection — this reads the public ledger from the indexer, exactly what
            any observer sees.
          </p>

          <label>Registry address to audit</label>
          <input
            type="text"
            value={auditorAddress}
            onChange={(e) => setAuditorAddress(e.target.value)}
            placeholder="contract address…"
          />
          <div className="row">
            <button onClick={runAudit} disabled={auditorBusy || !auditorAddress.trim()}>
              {auditorBusy ? <><span className="spinner" />Reading chain…</> : 'Read public state'}
            </button>
          </div>

          {auditorError && <div className="note" style={{ borderLeftColor: 'var(--err)' }}>{auditorError}</div>}

          {auditor && (
            <>
              <div className="note">
                Latest action: tx <span className="addr">{auditor.txHash}</span>
                {auditor.blockHeight !== null && <> · block {auditor.blockHeight}</>}
                {auditor.blockTime && <> · {auditor.blockTime}</>}
              </div>
              <PublicTable state={auditor.state} />
            </>
          )}

          {!auditor && publicState && (
            <>
              <div className="note">Live view via wallet-side indexer subscription.</div>
              <PublicTable state={publicState} />
            </>
          )}

          <div className="privacy-callout">
            <div className="grid">
              <div className="cell public">
                <h3>Public — on the ledger</h3>
                <ul>
                  <li>control IDs</li>
                  <li>opaque 32-byte commitments</li>
                  <li>verified flags + proof counter</li>
                </ul>
              </div>
              <div className="cell private">
                <h3>Private — this browser only</h3>
                <ul>
                  <li>the evidence record text</li>
                  <li>its SHA-256 digest</li>
                  <li>the commitment salt</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PublicTable({ state }: { state: PublicRegistryState }) {
  return (
    <>
      <table className="table">
        <thead>
          <tr><th>Control</th><th>Commitment (opaque)</th><th>Status</th></tr>
        </thead>
        <tbody>
          {state.rows.length === 0 && (
            <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>Registry is empty.</td></tr>
          )}
          {state.rows.map((row) => (
            <tr key={row.controlId.toString()}>
              <td>{row.controlId.toString()}</td>
              <td className="commitment">{row.commitmentHex}</td>
              <td>
                {row.verified
                  ? <span className="pill verified">✓ evidence proven</span>
                  : <span className="pill registered">registered, unproven</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub" style={{ marginTop: 8 }}>
        Total successful proofs: {state.totalVerifications.toString()} — and not one byte of
        evidence content on-chain.
      </p>
    </>
  );
}
