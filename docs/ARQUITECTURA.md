# Arquitectura

Cascada registra facturas con doble firma, reparte pagos en cascada y compensa deudas cruzadas entre empresas de una cadena de subcontratación, todo en un contrato Soroban en **Stellar Testnet**.

## Visión general

```mermaid
flowchart LR
    subgraph Usuarios["Empresas de la cadena"]
        CL["Cliente"]
        CO["Contratista"]
        SU["Subcontratas<br/>sub1 · sub2"]
    end

    subgraph Front["Frontend (React · Vercel)"]
        UI["Panel tengo / debo<br/>Facturas · Pago en cascada"]
        PKG["packages/cascada<br/>cliente JS/TS"]
        CFG[("demo-config.json")]
    end

    W["Wallet<br/>Freighter / Stellar Wallets Kit"]

    subgraph Stellar["Stellar Testnet"]
        RPC["Stellar RPC"]
        SC["Contrato Soroban<br/>Cascada"]
        SAC["Token XLM<br/>(Stellar Asset Contract)"]
    end

    TW["Trustless Work<br/>escrow por hitos"]

    CL & CO & SU --> UI
    UI --> PKG
    CFG -.-> PKG
    PKG -- "lecturas sin wallet<br/>(simulación)" --> RPC
    PKG -- "firma de transacciones" --> W
    W -- "tx firmada" --> RPC
    RPC --> SC
    SC -- "transfer en cascada<br/>y pago neto" --> SAC
    SC -. "próximo paso" .-> TW
```

| Pieza | Qué hace |
|---|---|
| **Frontend (React)** | Panel tengo/debo, facturas y pago en cascada. Muestra los datos sin conectar wallet. |
| **`packages/cascada`** | Cliente JS/TS del contrato. Lee la interfaz del contrato desde la red (`contract.Client.from`). |
| **Wallet** | Freighter / Stellar Wallets Kit. Firma solo las acciones (proponer, aceptar, pagar, compensar). |
| **Stellar RPC** | Simula las lecturas y envía las transacciones firmadas. |
| **Contrato Cascada** | Guarda proyectos, facturas y deudas; ejecuta el reparto y la compensación. |
| **Token XLM (SAC)** | El contrato mueve los fondos con la interfaz de token estándar (SEP-41). |
| **Trustless Work** | Siguiente paso: escrow por hitos antes del `release`. |

## Flujo principal

```mermaid
sequenceDiagram
    autonumber
    actor S as Subcontrata
    actor C as Contratista
    actor CL as Cliente
    participant K as Contrato Cascada
    participant T as Token XLM (SAC)

    Note over S,K: 1 · Factura con doble firma
    S->>K: propose_invoice(importe, hash del PDF)
    K-->>S: id de factura (Proposed)
    C->>K: accept_invoice(id)
    K-->>C: Accepted → deuda reconocida on-chain

    Note over CL,T: 2 · Pago en cascada (una sola transacción)
    CL->>K: release(proyecto, 100 XLM)
    K->>T: 30 XLM → sub1 (30 %)
    K->>T: 20 XLM → sub2 (20 %)
    K->>T: 50 XLM → contratista (resto)

    Note over S,T: 3 · Compensación de deudas cruzadas
    C->>K: settle(deudor = contratista, acreedor = sub1)
    K->>K: 50 − 20 = 30 XLM netos
    K->>T: 30 XLM → sub1
```

1. **Doble firma**: quien cobra propone la factura con el SHA-256 del PDF; solo cuando quien paga la acepta pasa a ser deuda on-chain.
2. **Pago en cascada**: un único `release` reparte el dinero entre todas las subcontratas según su porcentaje, de forma atómica (o cobran todas o ninguna).
3. **Compensación**: si dos empresas se deben dinero mutuamente, `settle` cancela ambas deudas y solo se transfiere la diferencia.

Detalles del contrato desplegado: [CONTRATO.md](CONTRATO.md).
