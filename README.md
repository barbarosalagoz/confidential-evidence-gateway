# Confidential Evidence Gateway

**Prove a private compliance score meets a public policy threshold — without
revealing the score.** (Level 1)

**Prove a valid evidence record exists for a compliance control — without
revealing the record.** (Level 2)

A Midnight Network smart contract suite, CLI and web DApp. Levels 1 and 2 of
the Rise In / Midnight Network challenge, built on Midnight **Preprod** (public
testnet, test tokens only).

> Status: unaudited demonstration of one privacy primitive. Not for production
> or mainnet. See [SECURITY.md](SECURITY.md).

---

## Initial Idea

This project explores a vendor-neutral confidential compliance gateway for global supply chains. Suppliers frequently need to prove regulatory, sustainability, or Digital Product Passport requirements to manufacturers, auditors, and software platforms, while the underlying evidence may contain commercially sensitive information such as exact material composition, supplier relationships, production data, or proprietary process metrics. The long-term goal is to allow trusted evidence to remain under the supplier's control while cryptographic proofs demonstrate that specific compliance conditions have been satisfied. For example, a supplier could prove that a confidential sustainability metric exceeds a required threshold without revealing the underlying value itself. Level 1 begins with the fundamental privacy primitive required for this architecture: proving that a private compliance value satisfies a public policy threshold while exposing only the minimum necessary public state.

---

## Deployment

| | |
|---|---|
| **Network** | Midnight Preprod (public testnet) |
| **Contract address** | `ff3ce6ef5f9f6d0f2eb21724476fca328f9c2ccaee768f3c91c32b8db08cf25f` |
| **Deploy transaction** | `5c9934f9bdee6fd6533f68046b8cc3d9a04a40a92959d90012e10990d6b0ec0e` (block 2306230, 2026-08-28T20:45:54Z) |
| **Claim transaction** | `267aba31601313b3f3f34cf6d143f015355ec4f9f77f4d2ed243484d83b02124` (block 2306359, 2026-08-28T20:58:48Z) |
| **Contract source** | [`contracts/counter.compact`](contracts/counter.compact) |
| **Circuit** | `proveCompliance()` |

A real compliance proof has been submitted on Preprod. Public ledger state
before and after that claim, read back from the chain with
`npm run verify:deploy` — no wallet needed, this is what any observer sees:

```
                       at deploy        after one claim
publicMinimumScore  :  70               70
verifiedClaims      :  0                1

fields exposed      :  publicMinimumScore, verifiedClaims
supplier score      :  NOT PRESENT      NOT PRESENT
```

The counter moved; the score did not appear. That is the entire claim of the
project, demonstrated on a public network rather than only in the simulator.
Reproduce the claim with `npm run claim -- --network preprod`.

The contract file is named `counter.compact` because the Level 1 checklist
expects that filename. The logic inside is a confidential compliance proof, not
a counter.

---

## Level 2 — Compliance-Evidence Commitment Registry

Level 1 proved a private *number* against a public threshold. Level 2 proves
the existence and integrity of a private *document*, from a real frontend, with
the Lace wallet: the **compliance-evidence commitment**.

> **The privacy claim, precisely.** For a public control ID `X`, a successful
> `proveEvidence(X)` transaction proves on the public ledger that *the caller
> knows an evidence record whose commitment equals the one registered for
> `X`* — that is, "a valid evidence record exists for control X and its holder
> demonstrated knowledge of it". What is **proven**: existence, integrity
> (any change to the record breaks the proof), and knowledge of the record
> behind the registered commitment. What stays **hidden**: the record's
> content, its SHA-256 digest, and the commitment salt — none of them appear
> in the transaction, the public transcript, or the ledger, in any encoding.
> **Why**: the ledger stores only `persistentCommit(digest, salt)` — a hiding
> and binding commitment. The salt is 32 uniformly random bytes, so the
> commitment is statistically independent of the content; the digest and salt
> enter the ZK circuit as witnesses, and only the proof's success or failure
> escapes it. A failed proof produces no transaction at all — failed attempts
> are not just private, they are invisible.

### Level 2 deployment

| | |
|---|---|
| **Network** | Midnight Preprod (public testnet) |
| **Contract address** | `c421e7a82bf0c793e1a99218152ce6bdafb89f55dc12e2dd046458b6e5991df5` |
| **Deploy transaction** | `b6c7bf2f14152b82656ed1f8558a9f924f3ed158a048e9ab11d85ba197f4b22f` (block 2376823, 2026-09-02T18:25:36Z) |
| **Contract source** | [`contracts/evidence.compact`](contracts/evidence.compact) |
| **Circuits** | `registerEvidence(controlId)`, `proveEvidence(controlId)` |
| **Live demo** | _pending — Vercel_ |

A real register + prove cycle has been executed on Preprod:

| | |
|---|---|
| `registerEvidence(1001)` | tx `e2ccd1b387be04596212fce377a96e42312f2d721146839515d62ae54b215890` (block 2376875) |
| `proveEvidence(1001)` | tx `da2c1f110c8e68c1580997ed01898ecb45df0cadbf9be856fa70c98d3b23edcb` (block 2376879) |

What any observer reads back from the chain afterwards — no wallet needed:

```
totalVerifications : 1
control 1001
  commitment : b1c7ffe6e94918035387a6ce9d991ee1ab54e0503d3750b2a03cd4d00c02e30c (opaque)
  verified   : ✓ proven

evidence contents  : NOT PRESENT — only commitments and verified flags are public
```

Reproduce that view yourself:

```bash
npm run verify:evidence -- --network preprod
```

Run your own cycle (needs a funded Preprod wallet and the local proof server):

```bash
npm run submit:evidence -- --network preprod --control 2002 --content "your confidential record"
```

### The Level 2 contract

```compact
export ledger evidenceCommitments: Map<Uint<64>, Bytes<32>>;
export ledger verifiedControls: Map<Uint<64>, Boolean>;
export ledger totalVerifications: Counter;

witness evidenceDigest(controlId: Uint<64>): Bytes<32>;
witness evidenceSalt(controlId: Uint<64>): Bytes<32>;

export circuit registerEvidence(controlId: Uint<64>): [] {
  const commitment = persistentCommit<Bytes<32>>(evidenceDigest(controlId), evidenceSalt(controlId));
  evidenceCommitments.insert(disclose(controlId), disclose(commitment));
  verifiedControls.insert(disclose(controlId), false);
}

export circuit proveEvidence(controlId: Uint<64>): [] {
  assert(evidenceCommitments.member(disclose(controlId)), "no evidence registered for this control");
  const commitment = persistentCommit<Bytes<32>>(evidenceDigest(controlId), evidenceSalt(controlId));
  assert(evidenceCommitments.lookup(disclose(controlId)) == commitment, "evidence does not match registered commitment");
  verifiedControls.insert(disclose(controlId), true);
  totalVerifications.increment(1);
}
```

`disclose()` is applied to exactly two things: the caller-chosen control ID
and the commitment itself — publishing them is the point. It is deliberately
**not** applied to the digest or salt; they exist only inside the circuit.
Re-registering a control resets its verified flag: replaced evidence must be
re-proven.

### Level 2 public/private boundary

**Public — on the ledger, visible to everyone**

| Value | Why it is public |
|---|---|
| control IDs | The catalog being audited against; meaningless without a shared control taxonomy, revealing at most *which* controls are in scope. |
| `evidenceCommitments[X]` | 32 opaque bytes per control. Hiding (random salt) and binding (changing the record breaks the proof). |
| `verifiedControls[X]` + `totalVerifications` | The observable outcome: an auditor can see *that* evidence was proven, which is the product. |

**Private — this machine/browser only, never transmitted**

| Value | Where it lives |
|---|---|
| Evidence record content | Browser `localStorage` (web) / LevelDB store (CLI) — the DApp's local private state. |
| SHA-256 digest of the record | Same store; witness input only. |
| Commitment salt | Same store; witness input only. |

Two different evidence records produce byte-identical public *shapes* (same
flags, same counter, equally opaque 32-byte commitments) — asserted directly
in the test suite (`tests/evidence.test.ts`), along with a deep scan proving
the digest and salt appear nowhere in public state or the public transcript.

### The web DApp (`web/`)

A Vite + React frontend on the same pinned Ledger-8 stack:

- **Lace connect/disconnect** via the DApp Connector API `4.x`: wallets are
  enumerated from `window.midnight` (UUID keys, no hardcoded name) and
  filtered by a semver check on `apiVersion`.
- **Circuits called from the UI**: `registerEvidence` / `proveEvidence` run
  through `findDeployedContract(...).callTx`, with tx hash and block height
  surfaced in the activity log.
- **Proving**: delegated to the wallet via `getProvingProvider()` (the
  current, non-deprecated path), falling back to the proof server URI the
  wallet advertises. ZK artifacts (`/keys/*.prover|.verifier`,
  `/zkir/*.bzkir`) are served from the site's own origin.
- **Local private state**: a `localStorage`-backed `PrivateStateProvider`
  scoped per contract address holds the evidence records; the witness
  implementations read from it at proving time.
- **Auditor view**: reads public state straight from the Preprod indexer with
  *no wallet at all* — exactly what any observer sees. This is the demo of
  the privacy claim: verified flags visible, evidence absent.

Run it locally:

```bash
npm run compile:evidence     # once, repo root (artifacts are also committed)
cd web && npm install && npm run dev
```

Requirements for submitting transactions: Chrome with the Lace (Midnight
Preview) extension, wallet switched to **Preprod**, and some tDUST from the
[Preprod faucet](https://faucet.preprod.midnight.network/). The auditor panel
works with nothing installed at all.

### Level 2 limits, stated plainly

- The circuit proves knowledge of the *committed* record, not that the record
  is *true* — binding commitments to attested real-world evidence (signatures
  from an issuing auditor) remains future work, as documented since Level 1.
- Anyone holding the record (digest + salt) can run `proveEvidence`; the
  registry does not bind controls to an owner key. Adding an owner public key
  per control (as in the bboard pattern) is a straightforward extension.
- Control IDs are public by design; if the *set* of controls under audit is
  itself sensitive, IDs should be randomized handles.

---

## Privacy Model

The entire point of the project is the line between these two tables.

### Public — on the ledger, visible to everyone

| Value | Type | Why it is public |
|---|---|---|
| `publicMinimumScore` | `Uint<64>` | The policy threshold being enforced. A policy nobody can read cannot be audited against, so this is deliberately disclosed at construction — the single `disclose()` call in the contract. |
| `verifiedClaims` | `Counter` | How many claims have been verified. Lets a verifier confirm claims were made and counted. |

Also inherently public, as on any chain: the contract address, transaction
timing, fees, and the submitting wallet address.

### Private — never transmitted, never on-chain

| Value | Where it lives | Protection |
|---|---|---|
| `complianceScore()` | Supplier's machine only | A **witness**. Passed to the local proof server as a private input; never appears in the transaction. |
| Private-state store | Local disk, encrypted | Holds the score between runs. |
| Wallet seed / recovery phrase | `.midnight-state.json`, mode `0600` | Git-ignored. |

### What an observer actually sees

A successful claim changes exactly this much:

```
publicMinimumScore : 70          (unchanged)
verifiedClaims     : n  →  n+1
```

They **cannot** tell whether the supplier scored 71 or 2⁶³ − 1 — those two
cases produce byte-identical public state, which is asserted directly in the
test suite. And a claim that fails produces no proof, therefore no transaction,
therefore no trace at all: failed attempts are not merely private, they are
invisible.

`disclose()` is used **once**, on the constructor's threshold argument. It is
deliberately **not** applied to the witness. Comparing a witness against public
state inside `assert` is not a disclosure — only the success or failure of the
proof escapes the circuit, never the operand.

Full analysis, including the limits of this claim: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

---

## The contract

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

export ledger publicMinimumScore: Uint<64>;
export ledger verifiedClaims: Counter;

witness complianceScore(): Uint<64>;

constructor(minimumScore: Uint<64>) {
  publicMinimumScore = disclose(minimumScore);
}

export circuit proveCompliance(): [] {
  const score = complianceScore();
  assert(score >= publicMinimumScore, "compliance score below policy threshold");
  verifiedClaims.increment(1);
}
```

---

## Local setup (Linux)

Written for Ubuntu 26.04; any modern Linux with the same prerequisites works.

### Prerequisites

- **Node.js 22+** — the pinned version is in [`.nvmrc`](.nvmrc)
- **Docker Engine** with **Compose v2**
- **curl**, **git**

Confirm Docker works without `sudo`:

```bash
docker ps
```

If that fails with a permission error, add yourself to the `docker` group and
log out and back in:

```bash
sudo usermod -aG docker "$USER"
```

### 1. Install the Compact toolchain

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh

source ~/.bashrc            # or: export PATH="$HOME/.local/bin:$PATH"

compact update 0.31.1
compact --version           # compact 0.5.2
compact compile --version   # 0.31.1
```

> **Why 0.31.1 and not 0.34.x?** Compiler 0.34.0 targets **Ledger 9**, which is
> not yet deployed on Midnight's public networks. Contracts intended for
> current public networks stay on the **0.31.x** line, which targets Ledger 8.
> This is per `docs.midnight.network`, and is why `.github/workflows/ci.yml`
> pins the version explicitly.

### 2. Get the project

```bash
git clone <your-fork-url> confidential-evidence-gateway
cd confidential-evidence-gateway
nvm use                     # picks up .nvmrc
npm ci
```

### 3. Configure

```bash
cp .env.example .env
chmod 600 .env
```

Then edit `.env`:

| Variable | Visibility | Meaning |
|---|---|---|
| `MINIMUM_SCORE` | **Public** | The policy threshold. Goes on-chain. |
| `COMPLIANCE_SCORE` | **Private** | The supplier's actual score. Never leaves your machine. |
| `PRIVATE_STATE_PASSWORD` | **Private** | Encrypts the local private-state store. Min 16 chars. |

`.env` is git-ignored. Never commit it.

### 4. Compile and test

```bash
npm run compile   # → contracts/managed/counter/{contract,keys,zkir}/
npm test          # 19 Vitest tests, no network needed
```

`npm test` runs the compiled circuit in-process against a simulated ledger — no
proof server, no wallet, no funds.

### 5. Deploy to Preprod

```bash
npm run setup -- --network preprod
```

This starts the proof server in Docker, compiles, generates a wallet, and
deploys. On the first run it prints a **wallet address** and a **faucet URL**,
then waits: open the faucet, paste the address, request tNIGHT, and the script
continues on its own once the funds land.

> **Budget time for the first sync.** A brand-new wallet scans Preprod from
> genesis (~2.3M blocks), which took **~83 minutes** on a normal laptop at
> ~90% of one core. There is no progress indicator — the wallet SDK exposes
> only a boolean `isSynced` — so the elapsed-seconds ticker is all you get.
> This is a one-time cost: the synced state is written to
> `.midnight-wallet-state/` and later runs restore from it in seconds.
>
> You do not have to wait to request faucet funds. Run `npm run address` in
> another terminal — it derives the address locally from the stored seed and
> prints it immediately, so funding proceeds in parallel with the sync.

> ⚠️ The first run also prints a **BIP-39 recovery phrase**. Never screenshot,
> paste or commit it.

### 6. Interact

```bash
npm run cli            # submit proofs; read public ledger state
npm run verify:deploy  # read on-chain public state (no wallet, no sync)
npm run test:e2e       # reconnect and verify on-chain state
npm run check-balance  # wallet balance
```

---

## Project layout

```
contracts/counter.compact       the Level 1 Compact contract
contracts/evidence.compact      the Level 2 evidence-commitment contract
contracts/managed/counter/      generated: contract JS, prover/verifier keys, zkir
contracts/managed/evidence/     generated but COMMITTED (hosted web builds need it)
src/evidence.ts                 Level 2 private-state model + witnesses (browser-safe)
src/evidence-node.ts            Level 2 artifact loader (Node)
src/deploy-evidence.ts          Level 2 deploy; writes deployments/evidence.<network>.json
scripts/verify-evidence.ts      Level 2 observer view of on-chain public state
tests/evidence*.ts              Level 2 simulator + privacy tests
web/                            Level 2 frontend (Lace connect, circuits, auditor view)
src/compliance.ts               private-state type, witness impl, policy parsing
src/compiled-contract.ts        attaches witnesses to compiled artifacts
src/deploy.ts  src/cli.ts       deploy and interact
src/network.ts src/wallet.ts    network config, wallet handling
tests/                          Vitest suite (simulator + privacy scans)
scripts/e2e-check.ts            on-chain smoke check
docs/THREAT_MODEL.md            actors, trust assumptions, known limits
docs/CRYPTOGRAPHY.md            what is used; why it is not post-quantum
SECURITY.md                     reporting, scope, secret handling
.github/workflows/ci.yml        compile + test + secret hygiene
```

`contracts/managed/` is generated and git-ignored — CI rebuilds it from source.

---

## Toolchain versions

Verified against `docs.midnight.network` on 2026-08-28.

| Component | Version |
|---|---|
| Compact developer tools | 0.5.2 |
| Compact compiler | 0.31.1 |
| Compact language | 0.23.0 |
| Compact runtime | 0.16.0 |
| Ledger | 8 |
| Proof server | `midnightntwrk/proof-server:8.1.0` |
| Midnight.js | 4.1.1 |
| Wallet SDK | 1.2.0 |
| Node.js | 22.23.2 |

### A load-bearing dependency pin

`package.json` contains:

```json
"overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }
```

Do not remove it. `compact-runtime` depends on `^3.0.0` while
`midnight-js-protocol` pins exactly `3.0.0`, so npm hoists 3.1.0 for one and
nests a second 3.0.0 copy for the other. Each copy is a separate WASM
instance, so a `StateValue` produced by the generated contract is rejected by
the other copy's `ChargedState`, and **every circuit call fails** with:

```
Unexpected error executing scoped transaction: Error: expected instance of StateValue
```

Deployment still succeeds, which makes this easy to miss — it only bites on
the first `callTx`. The override forces one resolved copy. Note that pinning
alone is not sufficient if a stale tree already has two same-version copies;
`npm dedupe` collapses them, and `npm ci` from the committed lockfile then
reproduces the single copy.

---

## Security and cryptography

- [SECURITY.md](SECURITY.md) — reporting, scope, secret handling
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) — what is public, what is
  private, what is assumed, and what v0 does **not** solve
- [docs/CRYPTOGRAPHY.md](docs/CRYPTOGRAPHY.md) — Midnight's primitives are
  elliptic-curve based and **not post-quantum**. This project makes no
  quantum-safety claim; it documents how the architecture keeps a
  crypto-agility boundary so the future off-chain evidence layer can adopt
  NIST PQC (ML-KEM, ML-DSA) without redesigning the contract.

The most important limitation, stated up front: the circuit proves *"the value
I was given is ≥ the threshold"*, not *"my real-world metric is ≥ the
threshold"*. Binding the witness to attested evidence is the next level's work.

---

## License

MIT
