# @pelamandarinas/cascada

Cliente JS/TS del contrato **Cascada** para el frontend (Persona 2).

El cliente se crea con `contract.Client.from`, que lee la interfaz del contrato
directamente de la red: no hace falta el CLI ni regenerar bindings si cambia el contrato.

## Instalar en el frontend

```bash
npm i @stellar/stellar-sdk
npm i ../packages/cascada        # desde la carpeta del frontend
```

Copia `demo-config.json` (raíz del repo) a `src/` del frontend o impórtalo con la ruta relativa.

## Leer sin wallet (link de demo)

```ts
import config from "../../demo-config.json";
import { createCascadaClient, loadDashboard } from "@pelamandarinas/cascada";

const client = await createCascadaClient(config);
const d = await loadDashboard(client, config);

d.project.shares;   // [{ name: "sub1", percent: 30, ... }, { name: "sub2", percent: 20, ... }]
d.invoices;         // [{ id, issuerName, payerName, amountText, status: "Accepted" | "Proposed" | "Rejected", docHashHex }]
d.debts;            // [{ fromName: "contratista", toName: "sub1", amountText: "30" }]  (ya compensadas)
d.balances;         // [{ name, balanceText }]  positivo = tengo, negativo = debo
```

Lecturas sueltas: usa `call()`, que lanza `CascadaError` si el contrato falla
(el SDK por sí solo no lanza excepción en lecturas fallidas):

```ts
import { call } from "@pelamandarinas/cascada";
const inv = await call(client.get_invoice({ invoice_id: 3 }));
```

## Escribir con wallet (Stellar Wallets Kit / Freighter)

```ts
import { createCascadaClient, parseAmount, sha256OfFile, decodeCascadaError } from "@pelamandarinas/cascada";

const client = await createCascadaClient(config, {
  publicKey: address,                                   // dirección de la wallet conectada
  signTransaction: (xdr, opts) => kit.signTransaction(xdr, opts), // devuelve { signedTxXdr }
});

try {
  // Aceptar la factura pendiente (la firma quien paga)
  await (await client.accept_invoice({ invoice_id: 3 })).signAndSend();

  // Proponer una factura con el hash del PDF
  const doc_hash = await sha256OfFile(pdfFile);
  const tx = await client.propose_invoice({
    project_id: 1, issuer: address, payer: config.accounts.contratista,
    amount: parseAmount("15"), doc_hash,
  });
  const { result: invoiceId } = await tx.signAndSend();

  // Pago en cascada (cliente o contratista)
  await (await client.release({ project_id: 1, payer: address, amount: parseAmount("100") })).signAndSend();

  // Compensar deudas y pagar solo el neto (firma el deudor)
  await (await client.settle({ debtor: address, creditor: config.accounts.sub1 })).signAndSend();
} catch (e) {
  const err = decodeCascadaError(e);
  alert(err ? err.message : String(e));
}
```

Importes en *stroops* (`bigint`, 7 decimales): usa `parseAmount("12.5")` y `formatAmount(125000000n)`.

## Redes desplegadas

| Red | contractId | Config |
|---|---|---|
| Testnet | `CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY` | `demo-config.json` |
| Futurenet | `CBKKKHEMPJ4XTYLB5ZSWVOFZXU3SAELGNSWQKDN2YKXYORRGW2TQT5MX` | `demo-config.futurenet.json` |

Ambos tienen los mismos datos de demo: proyecto 1 (sub1 30 %, sub2 20 %), 100 XLM ya liberados,
facturas 1 y 2 aceptadas (neto: contratista debe 30 XLM a sub1) y factura 3 de sub2 **pendiente** para aceptarla en directo.

## Bindings generados (opcional)

Si alguien prefiere los bindings del CLI:

```bash
stellar contract bindings typescript --network testnet \
  --contract-id CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY \
  --output-dir packages/cascada-generated --overwrite
```
