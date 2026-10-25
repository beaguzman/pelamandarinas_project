# Architecture

Cascada records double-signed invoices, splits payments down the subcontracting chain and nets out cross-debts between companies — all in a Soroban smart contract on **Stellar Testnet**.

## Overview

```mermaid
flowchart LR
    subgraph Users["Companies in the chain"]
        CL["Client"]
        CO["Contractor"]
        SU["Subcontractors<br/>sub1 · sub2"]
    end

    subgraph Front["Frontend (React · Vercel)"]
        UI["Owed / owing dashboard<br/>Invoices · Cascade payment"]
        PKG["packages/cascada<br/>JS/TS client"]
        CFG[("demo-config.json")]
    end

    W["Wallet<br/>Freighter / Stellar Wallets Kit"]

    subgraph Stellar["Stellar Testnet"]
        RPC["Stellar RPC"]
        SC["Soroban contract<br/>Cascada"]
        SAC["XLM token<br/>(Stellar Asset Contract)"]
    end

    TW["Trustless Work<br/>milestone escrow"]

    CL & CO & SU --> UI
    UI --> PKG
    CFG -.-> PKG
    PKG -- "reads without wallet<br/>(simulation)" --> RPC
    PKG -- "transaction signing" --> W
    W -- "signed tx" --> RPC
    RPC --> SC
    SC -- "cascade transfers<br/>and net payment" --> SAC
    SC -. "next step" .-> TW
```

| Component | What it does |
|---|---|
| **Frontend (React)** | Owed/owing dashboard, invoices and cascade payment. Shows data without connecting a wallet. |
| **`packages/cascada`** | JS/TS client for the contract. Reads the contract interface from the network (`contract.Client.from`). |
| **Wallet** | Freighter / Stellar Wallets Kit. Signs only the actions (propose, accept, pay, settle). |
| **Stellar RPC** | Simulates reads and submits signed transactions. |
| **Cascada contract** | Stores projects, invoices and debts; executes the split and the netting. |
| **XLM token (SAC)** | The contract moves funds through the standard token interface (SEP-41). |
| **Trustless Work** | Next step: milestone escrow before `release`. |

## Main flow

```mermaid
sequenceDiagram
    autonumber
    actor S as Subcontractor
    actor C as Contractor
    actor CL as Client
    participant K as Cascada contract
    participant T as XLM token (SAC)

    Note over S,K: 1 · Double-signed invoice
    S->>K: propose_invoice(amount, PDF hash)
    K-->>S: invoice id (Proposed)
    C->>K: accept_invoice(id)
    K-->>C: Accepted → debt recognized on-chain

    Note over CL,T: 2 · Cascade payment (a single transaction)
    CL->>K: release(project, 100 XLM)
    K->>T: 30 XLM → sub1 (30 %)
    K->>T: 20 XLM → sub2 (20 %)
    K->>T: 50 XLM → contractor (remainder)

    Note over S,T: 3 · Cross-debt netting
    C->>K: settle(debtor = contractor, creditor = sub1)
    K->>K: 50 − 20 = 30 XLM net
    K->>T: 30 XLM → sub1
```

1. **Double signature**: the party getting paid proposes the invoice with the SHA-256 hash of the PDF; it only becomes an on-chain debt once the payer accepts it.
2. **Cascade payment**: a single `release` splits the money among all subcontractors according to their share, atomically (either everyone gets paid or no one does).
3. **Netting**: if two companies owe each other money, `settle` cancels both debts and only the difference is transferred.

Deployed contract details: [CONTRATO.md](CONTRATO.md).
