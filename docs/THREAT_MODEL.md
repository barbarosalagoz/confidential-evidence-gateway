# Threat Model — Confidential Compliance Proof v0

Scope: the Level 1 contract in `contracts/counter.compact` and the client code
that drives it. The off-chain evidence layer described in the README's *Initial
Idea* is **not** built yet and is out of scope here.

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
5. **The proof server is trusted with private inputs.** It runs locally
   (`127.0.0.1:6300`) and receives the witness in order to build the proof.
   Pointing it at a remote host would hand the score to that host. Do not.

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

## 6. Not addressed at this level

Sybil resistance, revocation, key rotation, evidence storage and retention,
selective disclosure to named verifiers, and the auditor-attestation binding
in §3.2. These belong to the off-chain evidence layer and later levels.
