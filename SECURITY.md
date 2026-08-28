# Security Policy

## Scope and status

This repository is **Level 1 of a Rise In / Midnight Network challenge**: a
working demonstration of one privacy primitive, not a production system.

- It targets **Midnight Preprod (public testnet) only**.
- It uses **test tokens with no monetary value**. No mainnet code path exists.
- It has **not** been audited.

Do not deploy this to mainnet or use it to protect real commercial evidence in
its current form.

## Reporting a vulnerability

Report suspected vulnerabilities privately via **GitHub Security Advisories**
(the *Security* tab → *Report a vulnerability*) rather than as a public issue.

Please include what you did, what you observed, and why you believe it is a
problem. A privacy finding — anything that lets an observer learn or narrow
down a supplier's private compliance score — is the highest-severity class of
bug this project can have, and is always in scope.

Expect an acknowledgement within 7 days.

### In scope

- Any leak of the private witness value into public state, the transaction
  transcript, logs, or committed files
- Circuit logic errors that let an unqualified claim verify, or that block a
  qualified one
- Secrets reaching version control through gaps in `.gitignore`
- Dependency or supply-chain issues in the build and deploy path

### Out of scope

- Findings that require access to the developer's machine or its private-state
  store — that store is trusted by design (see `docs/THREAT_MODEL.md`)
- Denial of service against public Midnight testnet infrastructure
- Anything requiring a mainnet deployment, since none exists

## Handling secrets in this repository

The following must **never** be committed, and are excluded in `.gitignore`:

| Item | Where it lives |
|---|---|
| Wallet seed and BIP-39 recovery phrase | `.midnight-state.json` (mode `0600`) |
| Wallet sync cache | `.midnight-wallet-state/` |
| The supplier's private compliance score | `.env`, and `midnight-level-db/` (the encrypted private-state store) |
| Private-state store password | `.env` (`PRIVATE_STATE_PASSWORD`) |

`.env.example` documents every variable with no real values in it.

If a secret is ever committed, treat it as compromised: rotate the wallet
(generate a fresh seed), fund a new address from the faucet, and redeploy.
Rewriting history is not sufficient on its own — a pushed secret should be
assumed to have been read.

### Before sharing screenshots or screen recordings

Deployment output includes wallet addresses and, on first run, a **recovery
phrase**. Before publishing any screenshot:

- Ensure no seed or mnemonic is in frame, including in scrollback
- Ensure no `.env` contents or private score value is visible
- A contract address, a wallet address and a tNIGHT balance are safe to show

## Cryptography

See `docs/CRYPTOGRAPHY.md`. In short: Midnight's proof system rests on
**elliptic-curve** assumptions, which are **not post-quantum secure**. This
project makes no quantum-safety claim.
