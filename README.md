# Confidential Evidence Gateway

**Prove a private compliance score meets a public policy threshold — without
revealing the score.**

A Midnight Network smart contract and client. Level 1 of the Rise In / Midnight
Network challenge, built on Midnight **Preprod** (public testnet, test tokens
only).

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
| **Contract address** | `CONTRACT_ADDRESS_PLACEHOLDER` |
| **Contract source** | [`contracts/counter.compact`](contracts/counter.compact) |
| **Circuit** | `proveCompliance()` |

The contract file is named `counter.compact` because the Level 1 checklist
expects that filename. The logic inside is a confidential compliance proof, not
a counter.

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

> ⚠️ The first run also prints a **BIP-39 recovery phrase**. Never screenshot,
> paste or commit it.

### 6. Interact

```bash
npm run cli            # submit proofs; read public ledger state
npm run test:e2e       # reconnect and verify on-chain state
npm run check-balance  # wallet balance
```

---

## Project layout

```
contracts/counter.compact       the Compact contract
contracts/managed/counter/      generated: contract JS, prover/verifier keys, zkir
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
