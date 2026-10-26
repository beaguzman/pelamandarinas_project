# Cascada Pay

> Transparent payments down the subcontracting chain, built on Stellar.
> HackMeridian 2026 · Genesis · Track: **Composed**

**Live demo:** https://pelamandarinas.vercel.app/ · **Video:** https://youtu.be/V6HyOq_4TCU · **Contract (Testnet):** [`CDR3…4AQY`](https://stellar.expert/explorer/testnet/contract/CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY)

---

## The problem

In construction, events or logistics, work is split along a chain: the **client** pays the **general contractor**, who then pays each **subcontractor**.

- **Invoices live in emails and PDFs.** They get lost or disputed, and there is no proof of what was agreed.
- **Money arrives late and step by step.** A subcontractor only gets paid when someone up the chain decides to forward the money.
- **No one sees who owes whom.** Companies that work together often owe each other money in both directions, and those debts pile up.

In the EU, about **1 in 2 invoices is paid late**, and **1 in 4 bankruptcies** is linked to unpaid invoices ([European Commission, 2023](https://single-market-economy.ec.europa.eu/system/files/2023-09/SOTEU_factsheet_2023_Late%20Payments%20Regulation_V6.pdf)). The small company at the end of the chain suffers most.

## The solution

Cascada Pay puts the chain's payment rules into a **Soroban smart contract** on Stellar, so no one has to trust anyone:

1. **Double-signed invoices.** The party getting paid proposes the invoice with the SHA-256 hash of its PDF. It only becomes a debt once the paying party approves it on-chain.
2. **Cascade payments.** One payment from the client is split to every subcontractor by their agreed share, in a **single atomic transaction**: either everyone gets paid or no one does.
3. **Debt netting.** When two companies owe each other, the contract cancels both debts and only the **net difference** is transferred.

### Example (the demo data)

| Step | What happens |
|---|---|
| Cascade payment | The client releases **100 XLM** → Subcontractor A gets 30 (30 %), Subcontractor B gets 20 (20 %), the general contractor keeps 50. |
| Invoices | Sub A invoices the contractor 50 XLM (approved), the contractor invoices Sub A 20 XLM (approved), Sub B invoices the contractor 15 XLM (**awaiting approval**). |
| Netting | 50 − 20 = **30 XLM**: one transfer settles both debts. |

---

## Stellar integration

| Piece | How we use it |
|---|---|
| **Soroban smart contract** (Rust, `soroban-sdk` 28) | Stores projects, shares, invoices and debts; enforces authorization (`require_auth`) and executes the split and the netting. 13 unit tests. |
| **Stellar Asset Contract (SAC)** | Funds move through the standard SEP-41 token interface. The demo uses native XLM; switching to USDC only needs a different token address at deploy time. |
| **Stellar RPC** | The app reads all data by simulating contract calls, so the dashboard works **without connecting a wallet**. |
| **Freighter wallet** | Every action (approve/reject an invoice, release, settle) is signed by the right company in Freighter. |
| **Stellar Expert** | Every transaction can be audited publicly. |

**Composed track:** Cascada Pay combines Soroban, the Stellar Asset Contract, Stellar RPC and Freighter into a new B2B payment flow, with [Trustless Work](https://www.trustlesswork.com/) milestone escrow as the next building block.

📐 Architecture diagrams: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) · Contract reference: [docs/CONTRATO.md](docs/CONTRATO.md) · Demo script: [docs/DEMO.md](docs/DEMO.md)

### Deployed contract (Stellar Testnet)

| | |
|---|---|
| Contract | `CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY` |
| Token (XLM via SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| RPC | `https://soroban-testnet.stellar.org` |

### Contract functions

| Function | Signed by | Purpose |
|---|---|---|
| `create_project(client, contractor)` | contractor | Create a project |
| `add_subcontractor(project_id, sub, bps)` | contractor | Add a subcontractor with its share (10 000 bps = 100 %) |
| `propose_invoice(project_id, issuer, payer, amount, doc_hash)` | issuer | Propose an invoice with the PDF hash |
| `accept_invoice(id)` / `reject_invoice(id)` | payer | Approve or reject: only approved invoices become debt |
| `release(project_id, payer, amount)` | client or contractor | Cascade payment |
| `settle(debtor, creditor)` | debtor | Net out cross-debts and pay the difference |
| `get_project`, `get_invoice`, `invoice_count`, `debt_of`, `net_position` | — | Read-only |

---

## Repository structure

```text
contracts/cascada/   Soroban smart contract (Rust) + tests
packages/cascada/    JS/TS client for the contract (used by the frontend)
frontend/            React + Vite web app
scripts/             deploy-demo.ps1: deploy + load demo data
docs/                Architecture, contract reference, demo script
demo-config.json     Network, contract ID and demo accounts used by the app
```

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) 1.84+ with the `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli)
- [Freighter](https://www.freighter.app/) browser extension, set to **Testnet**

### 1. Clone

```bash
git clone https://github.com/beaguzman/pelamandarinas_project.git
cd pelamandarinas_project
```

### 2. Run the web app (uses the contract already deployed on Testnet)

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). The dashboard loads without a wallet; connect Freighter to approve invoices, release payments or settle debts.

### 3. Test and build the contract

```bash
cargo test -p cascada
stellar contract build --package cascada
```

### 4. Deploy your own copy (optional)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-demo.ps1 -Network testnet
```

This creates and funds four demo accounts (`cliente`, `contratista`, `sub1`, `sub2`), deploys a **new** contract, loads the demo data and overwrites `demo-config.json`. Copy it to `frontend/src/demo-config.json` so the app uses the new contract.

---

## Roadmap

- **Milestone escrow** with Trustless Work: funds are held until each phase of the job is approved.
- **Stablecoins** (USDC / EURC) instead of XLM.
- **Multi-party netting**: clear debt cycles across many companies at once.
- **Pilot** with a real contractor and its subcontractors.

## Team

| Name | Role |
|---|---|
| Marco Díaz Vera | Smart contracts |
| Abraham Romero Ardoy | Frontend |
| Beatriz Guzmán Sánchez | Integrations & deliverables |
