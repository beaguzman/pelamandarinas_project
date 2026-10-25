# Contrato Cascada (Soroban) — referencia rápida

**Red de la demo: Stellar Testnet**

| | |
|---|---|
| Contrato | `CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY` |
| Token (XLM nativo vía SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| RPC | `https://soroban-testnet.stellar.org` |
| Explorador | https://stellar.expert/explorer/testnet/contract/CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY |
| Config del frontend | `demo-config.json` |

Copia de respaldo en Futurenet: `demo-config.futurenet.json`.

## Funciones

| Función | Firma | Qué hace |
|---|---|---|
| `create_project(client, contractor)` | contratista | Crea un proyecto, devuelve el id |
| `add_subcontractor(project_id, sub, bps)` | contratista | Añade subcontrata con su % (10 000 bps = 100 %) |
| `propose_invoice(project_id, issuer, payer, amount, doc_hash)` | quien cobra | Factura con el SHA-256 del PDF |
| `accept_invoice(invoice_id)` / `reject_invoice` | quien paga | Doble firma: solo aceptada cuenta como deuda |
| `release(project_id, payer, amount)` | cliente o contratista | Pago en cascada atómico: cada subcontrata cobra su % y el resto va al contratista |
| `settle(debtor, creditor)` | deudor | Compensa deudas cruzadas y paga solo el neto |
| `get_project`, `get_invoice`, `invoice_count`, `project_count`, `debt_of`, `net_position`, `token` | — | Lecturas (sin wallet) |

## Datos de demo (proyecto 1)

- Cliente → contratista; sub1 30 %, sub2 20 %.
- `release` de 100 XLM ya hecho: sub1 30, sub2 20, contratista 50.
- Factura 1: sub1 cobra 50 al contratista (aceptada).
- Factura 2: contratista cobra 20 a sub1 (aceptada) → neto: contratista debe 30 a sub1.
- Factura 3: sub2 cobra 15 al contratista — **pendiente**, para aceptarla en directo (firma `contratista`).

## Redesplegar

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-demo.ps1 -Network testnet
```

Ojo: crea un contrato nuevo y sobrescribe `demo-config.json`.
