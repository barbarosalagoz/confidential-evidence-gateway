# Confidential Evidence Gateway

[![CI](https://github.com/barbarosalagoz/confidential-evidence-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/barbarosalagoz/confidential-evidence-gateway/actions/workflows/ci.yml)

**Prove a private compliance score meets a public policy threshold — without
revealing the score.** (Level 1)

**Prove a valid evidence record exists for a compliance control — without
revealing the record.** (Level 2)

**An issuer registers confidential compliance credentials; a holder proves
one is valid — unrevoked and unexpired at block time — without revealing the
score or who they are.** (Level 3)

A Midnight Network smart contract suite, CLI and web DApp. Levels 1–3 of the
Rise In / Midnight Network challenge, built on Midnight **Preprod** (public
testnet, test tokens only).

**Live demo:** <https://confidential-evidence-gateway-swvq.vercel.app> ·
**Demo video:** <https://youtu.be/wn4n3YQOEyE> ·
**Level 2 contract:** `c421e7a82bf0c793e1a99218152ce6bdafb89f55dc12e2dd046458b6e5991df5` on Preprod

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
> knows the `(digest, salt)` pair behind the commitment registered for `X`* —
> in the registry's convention, where the digest is the SHA-256 of an evidence
> record: "an evidence record matching what was registered for control X
> exists, and its holder demonstrated knowledge of it". What is **proven**:
> knowledge of the committed pair, and integrity relative to registration —
> any change to the record changes the digest and breaks the proof. What is
> **not** proven: that the digest is really the hash of a document, or that
> the document is true — the circuit sees only 32-byte values (see the limits
> below). What stays **hidden**: the record's content, its digest, and the
> salt — none of them appear in the transaction, the public transcript, or
> the ledger, in any encoding (asserted by deep-scan tests in
> `tests/evidence.test.ts`). **Why**: the ledger stores only
> `persistentCommit(digest, salt)` — a computationally hiding, binding,
> hash-based commitment; with a fresh 32-byte random salt, the published
> commitment reveals nothing feasible to extract about the digest or content.
> The digest and salt enter the ZK circuit as witnesses, and only the proof's
> success or failure escapes it.
>
> Also public, as for any contract call: the contract address, **which
> circuit was invoked** (`registerEvidence` vs `proveEvidence`), the control
> ID argument, transaction timing and fees, and the submitting party's
> transaction metadata — so an observer can correlate *when* controls were
> registered and proven, just not *what* the evidence says. A proof whose
> assertions fail locally produces no transaction at all — such attempts are
> invisible; only a race (e.g. the commitment being replaced between proving
> and inclusion) can surface as a visibly failed transaction.

### Level 2 deployment

| | |
|---|---|
| **Network** | Midnight Preprod (public testnet) |
| **Contract address** | `c421e7a82bf0c793e1a99218152ce6bdafb89f55dc12e2dd046458b6e5991df5` |
| **Deploy transaction** | `b6c7bf2f14152b82656ed1f8558a9f924f3ed158a048e9ab11d85ba197f4b22f` (block 2376823, 2026-09-02T18:25:36Z) |
| **Explorer** | [preprod.midnightexplorer.com](https://preprod.midnightexplorer.com) — search the contract address or tx hashes above |
| **Contract source** | [`contracts/evidence.compact`](contracts/evidence.compact) |
| **Circuits** | `registerEvidence(controlId)`, `proveEvidence(controlId)` |
| **Live demo** | [confidential-evidence-gateway-swvq.vercel.app](https://confidential-evidence-gateway-swvq.vercel.app) |
| **Demo video** | [youtu.be/wn4n3YQOEyE](https://youtu.be/wn4n3YQOEyE) |

The deployment record the frontend joins is committed at
[`deployments/evidence.preprod.json`](deployments/evidence.preprod.json).

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

**Private — never on-chain**

| Value | Where it lives | Who else sees it |
|---|---|---|
| Evidence record content | Browser `localStorage` (web) / password-encrypted LevelDB store (CLI). | Nobody — the content is never a witness; it never leaves the store. |
| SHA-256 digest of the record | Same store; witness input. | The **proving component**: the local proof server (CLI) or whatever prover the wallet is configured with (web). |
| Commitment salt | Same store; witness input. | Same as the digest. |

The honest phrasing is "never on-chain", not "never transmitted": generating a
proof requires handing the witnesses (digest and salt — not the content) to
the prover. With a local proof server that is your own machine; if Lace is
configured with a remote prover, that operator sees them too.

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

- The circuit proves knowledge of the committed `(digest, salt)` pair —
  nothing more. That the digest is the SHA-256 of an actual document is a
  client-side convention the circuit cannot check, and that the document is
  *true* is entirely out of scope. Binding commitments to attested real-world
  evidence (signatures from an issuing auditor) remains future work, as
  documented since Level 1.
- Anyone holding the digest + salt can run `proveEvidence`; the registry does
  not bind controls to an owner key. Adding an owner public key per control
  (as in the bboard pattern) is a straightforward extension.
- Control IDs, circuit names, and transaction timing are public by design;
  observers learn *which* controls are in scope and *when* they were
  registered or proven. If the control set itself is sensitive, IDs should be
  randomized handles.
- The web app's private state lives in **unencrypted** browser
  `localStorage`: anyone with access to the browser profile can read the
  evidence records. The CLI's LevelDB store is password-encrypted; an
  encrypted browser store is future work.
- Proving discloses the witnesses (digest + salt) to the proving component —
  run a local proof server, or understand that a remote prover configured in
  the wallet sees them.

---

## Level 3 — Confidential Compliance Credentials

Level 3 adds roles and time. An **issuer** (e.g. an audit firm) registers
credentials for **holders** (e.g. suppliers); a holder later proves, from
their own wallet, that they hold a credential of a given type that is
**not revoked** and **not expired at the current block time** — without
revealing the credential's content (the audit score), and without revealing
who they are. A **verifier** reads the outcome from public state alone.

| Role | Does | Needs |
|---|---|---|
| Issuer | `issueCredential`, `revokeCredential` | the issuer secret key (checked in-circuit against the on-chain `issuerPk`) |
| Holder | `proveCredential` | their holder secret key + the credential material (content, salt) received from the issuer out-of-band |
| Verifier | reads public state | nothing — no wallet |

### Level 3 deployment

| | |
|---|---|
| **Network** | Midnight Preprod (public testnet) |
| **Contract address** | `0fed435f0d6fe479753726feffeb7f4856ddea9c37ea1e8031ec089c1f28bcce` |
| **Issuer public key** | `a397b50edda3ba9afa4b0814857e799470840038d7a4676ce05df93f839fc10f` |
| **Deploy transaction** | `f75419404d870010c4ab15b4ffa784c4503817aae0f97663fdd83569756df6d2` (block 2486634, 2026-09-10T09:27:18Z) |
| **Explorer** | [preprod.midnightexplorer.com](https://preprod.midnightexplorer.com) — search the contract address or tx hashes |
| **Contract source** | [`contracts/credentials.compact`](contracts/credentials.compact) |
| **Circuits** | `issueCredential(credentialId, typeId, expiry)`, `revokeCredential(credentialId)`, `proveCredential(credentialId)`; pure `derivePk(sk, domain)` |
| **Deployment record** | [`deployments/credentials.preprod.json`](deployments/credentials.preprod.json) |
| **Live demo** | [confidential-evidence-gateway-swvq.vercel.app](https://confidential-evidence-gateway-swvq.vercel.app) — "Level 3 · Confidential credentials" |

**Real lifecycle executed on Preprod** (issuer and holder both driven from
this repo's CLI):

| Step | Result |
|---|---|
| `issueCredential(7001, type 1, expiry 2027-03-31)` | tx `acba359f7abd759ea70bf6db4db39e2af0bdcf52e8ad7b01d0bba8ef251b0c2b` (block 2486658) |
| `revokeCredential(7001)` | tx `5fb07614c004f7cd98341894f96fa126e628252d37c9c110d3b3987377bdbdee` (block 2486683) |
| `proveCredential(7001)` after revocation | **no transaction** — proving aborted locally with `failed assert: credential revoked` (the ledger's revoked set is consulted in-circuit) |
| `issueCredential(7002, type 1, expiry 2027-03-31)` | tx `68d52eb87d1d73505500939be7995890bdd4e077c75e4f8558ae145260aaddbc` (block 2486723) |
| `proveCredential(7002)` — holder proves: exists, not revoked, not expired at block time, I hold it | tx `19a5de7445fe1a6cb9bf08bf806fca381490db9cab88fe1df1ffbad601dcc9e4` (block 2486739) |

Observer readback after those steps (`npm run verify:credentials -- --network preprod`,
no wallet):

```
issuerPk               : a397b50edda3ba9afa4b0814857e799470840038d7a4676ce05df93f839fc10f
totalCredentialProofs  : 1
credential 7001
  type       : 1
  expiry     : 2027-03-31T00:00:00.000Z
  commitment : c9b2fd1a5cc0094f9ebec5bb2c0ec231075a9af4d2ac0479109e562dcf99d68f (opaque)
  revoked    : true
  verified   : false
  status     : revoked
credential 7002
  type       : 1
  expiry     : 2027-03-31T00:00:00.000Z
  commitment : 6c924fc24d150a7f7e4c46a8a29320c570f062aaa5518c1fe056272e0478312f (opaque)
  revoked    : false
  verified   : true
  status     : valid
content / score / holder identity : NOT PRESENT
```

Both credentials carry the same private content (score 92/100) — their
commitments are unrelated bytes, and nothing public says so.

### The Level 3 contract

```compact
export ledger issuerPk: Bytes<32>;
export ledger credentialCommitments: Map<Uint<64>, Bytes<32>>;   // id → commit([digest, holderPk], salt)
export ledger credentialTypes: Map<Uint<64>, Uint<64>>;
export ledger credentialExpiry: Map<Uint<64>, Uint<64>>;         // seconds since epoch
export ledger revokedCredentials: Set<Uint<64>>;
export ledger verifiedCredentials: Map<Uint<64>, Boolean>;
export ledger totalCredentialProofs: Counter;

witness issuerSecretKey(): Bytes<32>;
witness holderSecretKey(): Bytes<32>;
witness holderPublicKey(credentialId: Uint<64>): Bytes<32>;
witness credentialDigest(credentialId: Uint<64>): Bytes<32>;
witness credentialSalt(credentialId: Uint<64>): Bytes<32>;

export circuit derivePk(sk: Bytes<32>, domain: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([domain, sk]);
}

export circuit issueCredential(credentialId: Uint<64>, typeId: Uint<64>, expiry: Uint<64>): [] {
  assert(derivePk(issuerSecretKey(), pad(32, "cred:issuer")) == issuerPk, "caller is not the issuer");
  assert(!credentialCommitments.member(disclose(credentialId)), "credential id already issued");
  const commitment = persistentCommit<Vector<2, Bytes<32>>>(
    [credentialDigest(credentialId), holderPublicKey(credentialId)], credentialSalt(credentialId));
  credentialCommitments.insert(disclose(credentialId), disclose(commitment));
  credentialTypes.insert(disclose(credentialId), disclose(typeId));
  credentialExpiry.insert(disclose(credentialId), disclose(expiry));
  verifiedCredentials.insert(disclose(credentialId), false);
}

export circuit revokeCredential(credentialId: Uint<64>): [] {
  assert(derivePk(issuerSecretKey(), pad(32, "cred:issuer")) == issuerPk, "caller is not the issuer");
  assert(credentialCommitments.member(disclose(credentialId)), "unknown credential");
  revokedCredentials.insert(disclose(credentialId));
  verifiedCredentials.insert(disclose(credentialId), false);
}

export circuit proveCredential(credentialId: Uint<64>): [] {
  assert(credentialCommitments.member(disclose(credentialId)), "unknown credential");
  assert(!revokedCredentials.member(disclose(credentialId)), "credential revoked");
  assert(blockTimeLt(credentialExpiry.lookup(disclose(credentialId))), "credential expired");
  const holderPk = derivePk(holderSecretKey(), pad(32, "cred:holder"));
  const commitment = persistentCommit<Vector<2, Bytes<32>>>(
    [credentialDigest(credentialId), holderPk], credentialSalt(credentialId));
  assert(credentialCommitments.lookup(disclose(credentialId)) == commitment, "not the holder of this credential");
  verifiedCredentials.insert(disclose(credentialId), true);
  totalCredentialProofs.increment(1);
}
```

Three design points worth knowing:

- **"Issuer signature" is a ZK key check, not an on-chain signature.** The
  issuer's authority is knowledge of the secret key whose domain-separated
  hash equals `issuerPk`; the check happens inside the circuit, so no
  signature and no key ever appears in a transaction.
- **The holder's identity lives inside the commitment.** The holder's public
  key is a witness (issuer-side private state), never a circuit argument, and
  it is bound into `persistentCommit([digest, holderPk], salt)`. Proving
  requires the matching holder secret key, so only the holder can prove — yet
  the ledger never carries the holder's key.
- **Expiry is judged by the chain, not by the prover.** `blockTimeLt(expiry)`
  compares the block's `secondsSinceEpoch` (Ledger 8 block context) with the
  stored expiry during transcript execution, so a proof generated against a
  stale clock is rejected at inclusion. Verified against the pinned 0.31.1
  compiler by compiling and by the block-time-controlled simulator tests.

### Level 3 privacy model — what an observer can and cannot learn

Written against the ledger declarations above, not against the pitch.

**Can learn (public, by design)**

| Fact | Where | Why it is acceptable |
|---|---|---|
| The issuer's public key | `issuerPk` | Verifiers must know *whose* credentials these are. |
| Each credential **ID**, **type ID** and **exact expiry timestamp** | `credentialTypes`, `credentialExpiry` | A verifier needs the policy being attested (type) and validity window. Note the exact expiry can hint at the issue date (e.g. "issued ~1 year before"). |
| Whether a credential is **revoked** | `revokedCredentials` | Revocation must be observable to be useful. Revocation is public and permanent. |
| Whether a **valid proof has been presented** and how many proofs in total | `verifiedCredentials`, `totalCredentialProofs` | The observable outcome — the product. |
| An opaque 32-byte **commitment** per credential | `credentialCommitments` | Hash-based, computationally hiding, binding. Reveals nothing feasible about digest, holder or salt. |
| **Which circuit** was invoked, **when**, and transaction fees | any contract call | Standard chain metadata. Observers can build a timeline of issuance, revocation and proofs per credential ID. |
| That *some* wallet submitted each transaction | transaction | This project makes **no claim of wallet-level unlinkability**: whether the paying wallet can be tied to a holder depends on how the wallet balances fees, not on this contract. |

**Cannot learn (never on-chain, in any encoding — asserted by deep-scan tests)**

- The credential **content** and therefore the **score**.
- The content **digest** and the commitment **salt**.
- **Who the holder is**: the holder public key is a witness bound inside a
  salted commitment. Two credentials issued to the same holder have
  unlinkable commitments (fresh salt each time), so the ledger does not even
  reveal that they share a holder.
- The **issuer's and holder's secret keys**.
- Anything about a proof that **failed locally** — no transaction is produced.

**What a successful `proveCredential` actually establishes**: at the block in
which it was included, credential `X` existed, was not revoked, had not yet
reached its expiry (chain-judged), and the submitter knew `(digest, salt,
holderSecretKey)` consistent with the registered commitment. It does *not*
establish that the content is true, nor that the digest hashes a real
document — those are conventions between issuer and holder, outside the
circuit.

**Limits, stated plainly**

- `verifiedCredentials[X] = true` means "a valid proof was presented at some
  past block". The contract prevents *new* proofs after expiry or revocation
  (revocation also resets the flag), but expiry alone does not rewrite
  history: the verifier view derives *current* status from
  `revoked → expired → verified` using its own clock, and the CLI/web
  verifier print exactly that derivation.
- Block time carries the node's declared error bound
  (`secondsSinceEpochErr`); expiry precision is seconds, accuracy is the
  chain's.
- The issuer key is held in a local file (CLI) and, for the browser demo,
  imported into unencrypted `localStorage`. A production issuer would keep it
  in an HSM-backed signer; the contract does not care where it lives.
- The demo runs issuer and holder in one browser profile, so their private
  stores coexist; in reality the issuer hands `(content, salt)` to the holder
  out-of-band and never learns the holder's secret key (only the public key).
- Proving discloses the witnesses (digest, salt, keys' *derived* values as
  needed by the circuit) to the proving component — local proof server or the
  wallet's configured prover.

### Using Level 3

Web (Preprod, Lace on Chrome): open the live demo → connect → **Level 3** →
join the registry (address pre-filled). Issuer: import the issuer secret key
(from the deployer's `.credentials-issuer.preprod.key`), enter the holder's
public key (Holder panel → *Create / load holder key*), type, expiry, and the
confidential content → **Issue**. Hand the displayed content + salt to the
holder → Holder: **Store material** → **Prove credential**. Verifier: **Read
public state** (no wallet). Then Issuer: **Revoke** → the holder's next proof
fails locally and the verifier shows *revoked*.

CLI (same machine plays both roles):

```bash
npm run deploy:credentials -- --network preprod
npm run credentials -- --network preprod issue  --credential 7001 --type 1 --expiry 2027-03-31 --content "SOC2 Type II — score 92/100"
npm run credentials -- --network preprod prove  --credential 7001
npm run credentials -- --network preprod revoke --credential 7001
npm run verify:credentials -- --network preprod        # observer view, no wallet
```

Tests: `npm test` (Level 1–3 contract suites, 47 tests) and
`npm test --prefix web` (app tests). CI runs both on every push.

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
