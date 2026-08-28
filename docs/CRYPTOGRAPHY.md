# Cryptography

## Summary

**This system is not post-quantum secure, and this project makes no
quantum-safety claim.**

Midnight's zero-knowledge proof system and its transaction layer rest on
**elliptic-curve** hardness assumptions — discrete logarithm and its
relatives. Shor's algorithm breaks those assumptions on a sufficiently large
fault-tolerant quantum computer. No amount of application-level design in this
repository changes that, because the guarantee is inherited from the chain.

What this document does instead is state honestly what is used today, what
that protects against, and how the architecture is arranged so the parts we
*will* control can migrate to post-quantum primitives later without
redesigning the contract.

## What is in use today

Observable in the toolchain this project pins (Compact compiler 0.31.1,
language 0.23.0, `@midnight-ntwrk/compact-runtime` 0.16.0, Ledger 8):

- **Elliptic-curve operations on the Jubjub curve.** The Compact runtime
  exposes `CompactTypeJubjubPoint`, `ecAdd`, `ecMul`, `ecMulGenerator` and
  `hashToCurve` directly. Jubjub is an Edwards curve defined over the scalar
  field of BLS12-381, the standard construction for doing curve arithmetic
  cheaply *inside* a ZK circuit.
- **A field-arithmetic circuit model.** Compact compiles to a ZK intermediate
  representation (`.zkir`) with a proving key and a verifying key per circuit
  (`keys/proveCompliance.prover`, `keys/proveCompliance.verifier`).
- **Hash-based commitments** for persistent state
  (`persistentCommit`, `leafHash`, Merkle-tree digests in the runtime).

The security of a proof produced by this project therefore reduces to
elliptic-curve assumptions plus the collision resistance of the hash
functions used in commitments.

### Classical security

Against a classical adversary these are standard, well-analysed assumptions,
and the privacy property this project demonstrates holds: the transcript
carries no operand derived from the private witness (asserted directly in
`tests/compliance.test.ts`).

### Quantum security

| Primitive | Quantum impact |
|---|---|
| Elliptic-curve discrete log (Jubjub / BLS12-381) | **Broken** by Shor's algorithm |
| Hash-based commitments | Weakened by Grover's algorithm — roughly halved security level, mitigated by output size |

A future adversary with a cryptographically relevant quantum computer could
forge proofs and break the transaction layer's confidentiality. Note also the
**harvest-now-decrypt-later** exposure: anything confidential recorded today
that is protected only by an elliptic-curve assumption should be assumed
readable in the future.

This project's specific exposure to that is deliberately small, because
**the private compliance score is never transmitted at all** — it is not
encrypted-and-published, it simply never leaves the supplier's machine. There
is no ciphertext of the score for an adversary to harvest. What a future
quantum adversary could do is forge *new* proofs, not recover *past* private
values from the chain.

## Crypto-agility: how the architecture stays migratable

Midnight's own primitives are not ours to choose. The off-chain evidence layer
described in the README's *Initial Idea* — where the actual sensitive evidence
(material composition, supplier relationships, production data) will live — 
**is** ours to choose, and that is where NIST's post-quantum standards belong.

The architecture keeps the two apart so that swapping the off-chain layer does
not touch the contract:

1. **The contract knows nothing about evidence.** `contracts/counter.compact`
   sees one `Uint<64>` and one threshold. It has no encoding, transport or
   encryption concern, so changing how evidence is stored, sealed or signed
   cannot force a contract change.
2. **A single witness boundary.** Everything private enters through
   `witness complianceScore(): Uint<64>`, implemented in one place
   (`src/compliance.ts`). Today that reads a local private-state store. A later
   version can have it verify a PQC-signed attestation and derive the score
   from that, with no change above or below it.
3. **The public interface is a policy threshold, not a data format.** Verifiers
   depend on `publicMinimumScore` and `verifiedClaims`. Neither carries any
   cryptographic material, so neither pins us to an algorithm.

### Intended post-quantum choices for the off-chain layer

When that layer is built, the intended primitives are the NIST standards:

| Purpose | Algorithm | Standard |
|---|---|---|
| Key encapsulation — sealing evidence to a verifier | **ML-KEM** (Kyber) | FIPS 203 |
| Digital signatures — auditor attestation over evidence | **ML-DSA** (Dilithium) | FIPS 204 |
| Stateless hash-based signatures, where a conservative fallback is wanted | **SLH-DSA** (SPHINCS+) | FIPS 205 |

The expected deployment shape is **hybrid** — a classical primitive and a
post-quantum one composed together, so that the result is no weaker than the
stronger of the two. That is current best practice during the transition
period and avoids betting everything on either family.

**None of this is implemented yet.** It is stated here as the design
constraint the current structure is meant to preserve, so that the claim
"crypto-agility layer" means something checkable rather than being decoration.

## What we do not claim

- ❌ That this system is quantum-safe, quantum-resistant, or post-quantum
- ❌ That any PQC algorithm is currently in use anywhere in this repository
- ❌ That Midnight's chain-level cryptography is post-quantum
- ✅ That the private score is never transmitted, so there is no ciphertext of
  it on-chain to harvest
- ✅ That the boundary where PQC would be adopted is isolated to one module

## References

- NIST FIPS 203 — Module-Lattice-Based Key-Encapsulation Mechanism (ML-KEM)
- NIST FIPS 204 — Module-Lattice-Based Digital Signature Algorithm (ML-DSA)
- NIST FIPS 205 — Stateless Hash-Based Digital Signature Algorithm (SLH-DSA)
- Midnight documentation — <https://docs.midnight.network>
