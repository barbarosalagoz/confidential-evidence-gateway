# Roadmap — deferred from the Preprod MVP

Two production-readiness items are known, scoped and deliberately not in the
Preprod MVP. Each entry says what it needs and why it waits. Both were raised
in the Level 4 review; the reasoning behind the current behaviour is in
[`THREAT_MODEL.md`](THREAT_MODEL.md) and the README's "limits, stated
plainly" lists.

## 1. Encrypted private-state storage in the web app

**Today.** The web app's private state — holder secret key, credential
material (content, digest, salt), evidence records — is plain JSON in
`localStorage`, scoped per contract address
(`web/src/midnight/local-private-state-provider.ts`). Anyone with access to
the browser profile can read it. The issuer secret key is the one exception:
since Level 4 it is held in tab memory only and never persisted. The CLI's
LevelDB store is already password-encrypted
(`@midnight-ntwrk/midnight-js-level-private-state-provider`,
`PRIVATE_STATE_PASSWORD`).

**What it needs.**

- A passphrase step in the UI before the first private-state read, and a
  session-scoped key derived from it (WebCrypto: PBKDF2 or Argon2 via WASM
  into an AES-GCM key). The passphrase itself is never stored.
- `localStoragePrivateStateProvider` gains an encrypting layer: `set`
  encrypts each value, `get` decrypts; the `__index` key can stay plain
  (it lists private-state ids, not material). The signing-key store gets the
  same treatment.
- Export/import (`exportPrivateStates`, `importPrivateStates`) become real:
  today the `encryptedPayload` field is plain JSON with a fixed `salt`.
- A migration for existing plain-text entries, and a forgotten-passphrase
  story (there is none: the material is unrecoverable, which must be said
  in the UI).
- Tests in `web/src/midnight/` mirroring the existing provider tests, plus
  a scan that nothing under `evidence-gateway/` is readable without the key.

**Why deferred.** The MVP demonstrates the on-chain privacy claim: nothing
private reaches the ledger or the transcript. Browser-profile confidentiality
is a different threat (local access to the machine), which the threat model
already places outside what the contract can protect. Adding a passphrase
before the first click also changes the demo flow that the Level 3 video
shows. The CLI path, which is the production issuance path, is encrypted
already. Estimated effort: about two days.

## 2. A live Preprod end-to-end job in CI

**Today.** CI (`.github/workflows/ci.yml`) compiles the three contracts,
typechecks, runs the 57 contract tests against the in-process simulator and
the 49 app tests, builds the frontend, and checks that no secret-bearing
file is tracked. No job talks to Preprod, runs a proof server, or submits a
transaction. `npm run test:e2e` exists (`scripts/e2e-check.ts`): it
reconnects to the deployed Level 1 contract, reads its public state through
the indexer and asserts the ledger exposes only the threshold and the claim
count. It is read-only by construction (its wallet provider throws on
balance and submit), covers Level 1 only, and is **run manually** on a
developer machine with a synced wallet — it is not part of CI.

**What a minimal live job needs.**

- A dedicated Preprod wallet whose seed is a GitHub Actions secret, funded
  with tDUST from the faucet, and re-funded when it runs low (a check on
  balance before the run, with a clear failure message).
- `PRIVATE_STATE_PASSWORD` as a secret for the LevelDB store.
- The proof server as a service container (`midnightntwrk/proof-server:8.1.0`,
  the pinned version) if the job is to submit a real proof; a read-only
  variant needs only the indexer.
- Wallet sync time: a fresh wallet scans Preprod from genesis, which the
  README documents as minutes on first run. Either cache the wallet state
  directory between runs or accept the sync as the job's floor.
- Scope: extend `e2e-check.ts` (or add siblings) to Levels 2 and 3 —
  reconnect, read public state, and in the submitting variant run one
  `proveEvidence` / `proveCredential` against a credential the job's wallet
  holds. Preprod is a shared public testnet, so the job must tolerate
  indexer lag and occasional node hiccups without turning red on every push:
  run it on a schedule and on demand rather than on every PR.

**Why deferred.** The contract logic is exercised in-process by the
simulator on every push, and the on-chain claim has been demonstrated with
real Preprod transactions recorded in the README. A live job adds a funded
account, secrets and testnet flakiness to CI for a demonstration project;
the cost is justified when the deployment is meant to be kept green
continuously, not while contracts are still being redeployed per level.
Estimated effort: two to three days including flakiness handling.
