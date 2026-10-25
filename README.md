# 🛡️ Track&Pay (o el nombre de tu proyecto)

> B2B Restricted Payment & Fund Tracking System built on Stellar for HackMeridian 2026.

## 📌 Problem Overview
In B2B transactions, companies often transfer funds to vendors or suppliers intended for specific purposes (e.g., an event management company paying a catering partner €2,000 strictly for food and beverage inventory). 

Without escrow or strict fund tracking, there is no technical guarantee that the receiving company won't misallocate those funds before delivering the agreed service.

## 💡 Solution
**[Nombre de tu Proyecto]** leverages the **Stellar Network** and **Soroban smart contracts** to implement **conditional, purpose-bound transfers** and supply chain financial tracking between businesses.

* **Earmarked Payments:** Funds are locked or tagged with clear spending restrictions/metadata on-chain.
* **Milestone / Receipt Verification:** Funds are released or validated only when proof of valid business expense is submitted.
* **Full Transparency:** Immutable audit trail on Stellar ensuring both parties have real-time visibility into fund allocation.

---

## 🛠️ Tech Stack & Stellar Integration

* **Blockchain Network:** Stellar Testnet
* **Smart Contracts:** Soroban (Rust)
* **Frontend / Dashboard:** [p. ej. React / Next.js / Vue]
* **SDK / Tools:** `@stellar/stellar-sdk`, [Soroban CLI, Freighter Wallet, etc.]

### Stellar Features Used
- **Soroban Smart Contracts:** Enforces spending rules and conditional releases between B2B entities.
- **Stellar Assets / Tokens:** Transacting with stablecoins/tokens representing payment value.

---

## 🚀 Getting Started

Follow these instructions to run the project locally.

### Prerequisites
* [Node.js](https://nodejs.org/) (v18+)
* [Rust & Cargo](https://www.rust-lang.org/) (if building Soroban contracts)
* [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)
* A browser extension wallet like **Freighter Wallet** set to Stellar Testnet.

### 1. Clone the repository
```bash
git clone [https://github.com/tu-usuario/tu-repositorio.git](https://github.com/tu-usuario/tu-repositorio.git)
cd tu-repositorio