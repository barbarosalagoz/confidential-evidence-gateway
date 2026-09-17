# Threat Model — Confidential Compliance Proof v0

Scope: written for the Level 1 contract in `contracts/counter.compact` and
the CLI that drives it. Two parts apply to every level: §3.5 (the proving
component, which now covers the web app and Lace as well as the CLI) and §6
(repeatable proofs, written for Level 3). The off-chain evidence layer
described in the README's *Initial Idea* is **not** built yet and is out of
scope here.

## 1. Actors

| Actor | Role |
|---|---|
| **Supplier** | Holds the confidential compliance score. Runs the client, generates proofs. |
| **Verifier** | Manufacturer, auditor or platform. Reads public ledger state and trusts the proof. |
| **Chain observer** | Anyone at all. Reads every transaction and all public state. |
| **Policy setter** | Whoever deploys the contract and fixes the threshold. In v0 this is the supplier. |

## 2. What is public, what is private

| Value | Visibility | Why |
|---|---|---|
| `publicMinimumScore` | **Public** — on the ledger | The policy being enforced. A threshold nobody can read cannot be audited against. This is the single deliberate `disclose()` in the contract. |
| `verifiedClaims` | **Public** — on the ledger | Lets a verifier see that claims were made and counted. |
| Contract address, tx timing, submitter | **Public** — inherent to any chain | Not concealed by this design. See §5. |
| `complianceScore()` | **Private** — witness | The supplier's actual score. Fed to the prover locally; never in a transaction. |
| Private-state store contents | **Private** — local disk, encrypted | Holds the score between runs. |
| Wallet seed / recovery phrase | **Private** — local disk, mode `0600` | Spend authority. |

Verified in `tests/compliance.test.ts`: the score is absent from the ledger,
from `proofData.publicTranscript`, `.input` and `.output`, and from the
reconstructible query context — and two suppliers with wildly different scores
produce byte-identical public state.

## 3. Trust assumptions

The design is only as strong as these. Each is a real assumption, not a
formality:

1. **The supplier's machine is trusted.** The score, the private-state store
   and the wallet seed all live there in usable form. Anyone with local access
   or code execution learns the score. Nothing on-chain protects against this.
2. **The witness is truthful.** The circuit proves *"the value I was given is
   ≥ the threshold"*, **not** *"my real-world sustainability metric is ≥ the
   threshold"*. A supplier can feed the witness any number they like. Closing
   this gap requires binding the witness to attested evidence — a signature
   from an accredited auditor, or a commitment published in advance. That is
   the central task of the next level, not something v0 solves.
3. **The Compact compiler and proof system are correct.** Compiler 0.31.1,
   language 0.23.0, Ledger 8. A soundness bug in the toolchain breaks every
   guarantee here.
4. **Elliptic-curve assumptions hold.** See `docs/CRYPTOGRAPHY.md`. Not
   post-quantum.
5. **The proving component is trusted with the witnesses.** Whatever builds
   the proof receives every witness the circuit takes: for Level 1 the
   score; for Levels 2 and 3 the evidence or credential digest, the
   commitment salt and the secret keys' circuit inputs. Never the content
   itself, which is not a witness. Which component that is depends on the
   client:
   - **CLI and scripts**: a local proof server (`127.0.0.1:6300`, the Docker
     container from `docker-compose.yml`). Witnesses stay on the machine.
     `MIDNIGHT_PROOF_SERVER_URL` can point elsewhere; doing so hands the
     witnesses to that host.
   - **Web app, default "Lace-delegated" mode**: the proof is built by
     whatever proof server the Lace wallet is configured with, which **may
     be a remote, hosted prover**. The app shows a warning after joining
     when that prover is not localhost, or when Lace does not report one.
   - **Web app, "App → proof server" mode**: the URL entered in the app,
     `http://localhost:6300` by default.

   Recommendation: when the witnesses themselves are confidential — a real
   score, a real salt guarding a real commitment — prove locally: run the
   proof-server container and either point Lace at it or use the direct
   mode. A remote prover sees exactly what a local one does; the only
   difference is who operates it. Nothing on-chain changes either way.

## 4. What an adversary sees

A chain observer watching a successful claim sees exactly:

```
publicMinimumScore : 70          (unchanged, set at deployment)
verifiedClaims     : n → n+1
```

plus the transaction envelope: contract address, block height, timestamp, fees,
and the submitting wallet address. The public transcript contains the circuit's
read of the threshold and its increment of the counter — no operand derived
from the witness.

What the observer **cannot** determine:

- The supplier's score, or any bound on it tighter than "≥ 70"
- Whether the supplier scored 71 or 2⁶³ — those cases are indistinguishable
- Anything about failed attempts: a claim below the threshold produces no proof
  and therefore no transaction, so it leaves no trace at all

## 5. Known limitations of v0

These are real and are stated rather than papered over:

- **Threshold-only disclosure is still disclosure.** Every successful claim
  proves score ≥ 70. A verifier who watches the same supplier prove against
  several different thresholds over time can narrow the score by bisection.
  v0 has one fixed threshold, so this only bites once the pattern generalises.
- **No identity binding.** `verifiedClaims` counts claims, not suppliers.
  Anyone holding the private state can increment it, and one supplier can
  increment it repeatedly. There is no notion of *who* proved compliance.
- **Metadata is not private.** The submitting wallet address is visible, so
  claims by the same wallet are linkable, and timing may correlate with
  off-chain events.
- **Unauthenticated witness.** Per assumption 2, the score is self-asserted.
- **Anyone can call the circuit.** There is no access control on
  `proveCompliance()`.
- **The threshold is fixed at deployment.** Changing policy means redeploying.

## 6. Level 3 proofs are repeatable by design

Scope note: §1–§5 above were written for the Level 1 contract. This section
covers `proveCredential` in `contracts/credentials.compact` (Level 3); the
same reasoning applies to `proveEvidence` in `contracts/evidence.compact`.

**A holder can present the same credential any number of times.** Every
successful `proveCredential(id)` re-runs the full check — the credential
exists, is not revoked, has not reached its expiry at the block time of
inclusion, and the caller knows `(digest, salt, holderSecretKey)` behind the
registered commitment — and then sets `verifiedCredentials[id] = true` and
increments `totalCredentialProofs`. Nothing records that a proof for `id` has
already been presented, and nothing refuses a second one. Asserted in
`tests/credentials.test.ts` ("repeated proofs") and, for Level 2, in
`tests/evidence.test.ts`; Level 1 has behaved the same since v0
(`tests/compliance.test.ts`, "increments exactly once per verified claim").

**What `verifiedCredentials[id] = true` means.** At some past block, a valid
proof for `id` was included: the credential was live at that block and the
submitter held the material. Revocation resets the flag to `false`; expiry
does not rewrite it, which is why the verifier view derives *current* status
as `revoked → expired → verified` against its own clock.

**What it does not mean.** Not "proven exactly once", not "proven recently",
not "proven to *you*". The flag is a registry-wide fact about the
credential, not a receipt for a particular verifier or a particular
presentation. `totalCredentialProofs` counts presentations, not distinct
credentials. And, as everywhere in this project, a proof establishes
knowledge of the committed material, not that the credential's content is
true (§3.2).

**Why there is no nullifier.** The product is a public registry status that
a verifier reads without interacting with the holder. In that model a
repeated proof is harmless: it re-establishes a fact that is already public
and changes no state except the counter. A nullifier — a per-presentation
value derived from the holder's secret, published so a second presentation
can be recognised and refused — buys nothing here and would cost linkability
(every presentation of `id` would publish a value tied to it) and a larger
circuit.

**When one would be required.** The moment a proof is meant to be consumed
by a specific verifier as a one-time act — a ticket, a voucher, an
authorisation that must not be replayed to a second party or a second time
— the registry status is the wrong primitive. A single-use presentation
needs a verifier-chosen challenge bound into the proof (so a captured proof
cannot be replayed elsewhere) and a nullifier set on-chain or at the
verifier (so it cannot be replayed twice). That is a different circuit and a
different protocol between holder and verifier, not a change to this one,
and it is out of scope for the Preprod MVP.

## 7. Not addressed at this level

Sybil resistance, revocation, key rotation, evidence storage and retention,
selective disclosure to named verifiers, and the auditor-attestation binding
in §3.2. These belong to the off-chain evidence layer and later levels.
