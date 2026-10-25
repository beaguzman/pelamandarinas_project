# Guion de la demo (vídeo de unos 3 minutos)

Red: **Stellar Testnet** · Contrato `CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY`

## Antes de grabar (checklist)

- [ ] Freighter instalado y en **Testnet**, con las cuentas importadas y renombradas: `Cliente`, `Contratista` (y `Sub1` opcional).
- [ ] Link de la demo abierto en una pestaña y [stellar.expert del contrato](https://stellar.expert/explorer/testnet/contract/CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY) en otra.
- [ ] El panel muestra: factura 3 **pendiente**, contratista **−30**, sub1 **+30**.
- [ ] Ensayo hecho antes con `demo-config.futurenet.json` (tiene los mismos datos), para no gastar los datos de testnet.
- [ ] Zoom del navegador al 125 %, notificaciones silenciadas, grabador listo (OBS o Xbox Game Bar: `Win + Alt + R`).

> Cada acción en directo cambia los datos (la factura 3 deja de estar pendiente, la deuda se compensa). Si hay que repetir la grabación, mira «Reiniciar los datos» al final.

## Guion

| Tiempo | Pantalla | Qué hacer | Qué decir |
|---|---|---|---|
| 0:00–0:20 | Portada / deck | — | «En una obra, el cliente paga al contratista y este a sus subcontratas. Las facturas se pierden, los pagos se retrasan y nadie ve quién debe qué. Cascada lo resuelve en Stellar.» |
| 0:20–0:50 | Panel (sin wallet) | Enseñar proyecto, porcentajes y el tengo/debo | «Esto es público y se lee directamente del contrato, sin conectar wallet. Proyecto 1: sub1 se lleva el 30 %, sub2 el 20 %. Ya se han liberado 100 XLM. Ahora mismo el contratista debe 30 XLM a sub1.» |
| 0:50–1:30 | Facturas | Conectar Freighter como **Contratista** → **Aceptar** la factura 3 → firmar | «Sub2 ha subido una factura de 15 XLM con el hash de su PDF. Hasta que el contratista no la firma, no cuenta como deuda. Acepto… firmo… y ahora es deuda reconocida en la cadena, con el hash del documento como prueba.» |
| 1:30–2:10 | Pago en cascada | Cambiar a **Cliente** → **Liberar 100 XLM** → firmar → abrir la transacción en stellar.expert | «El cliente paga 100 XLM y, en una sola transacción, el contrato reparte 30 a sub1, 20 a sub2 y 50 al contratista. Es atómico: o cobran todos o nadie. Las subcontratas no dependen de que alguien les reenvíe el dinero.» |
| 2:10–2:40 | Tengo / debo | Como **Contratista** → **Compensar** con sub1 → firmar | «Sub1 le facturó 50 al contratista y el contratista le facturó 20. En lugar de dos pagos, el contrato compensa y solo se mueven los 30 netos. La deuda desaparece del panel.» |
| 2:40–3:00 | Diagrama / deck | — | «Todo corre en un contrato Soroban en Stellar, con el token estándar (SAC) y wallets como Freighter. Siguiente paso: escrow por hitos con Trustless Work y pagos en USDC.» |

## Plan B (si falla el frontend)

Desde el PC donde se hizo el deploy (las cuentas existen en el `stellar` CLI):

```powershell
# Aceptar la factura 3
stellar contract invoke --id CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY --source-account contratista --network testnet -- accept_invoice --invoice_id 3

# Pago en cascada de 100 XLM (1 XLM = 10 000 000)
stellar contract invoke --id CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY --source-account cliente --network testnet -- release --project_id 1 --payer cliente --amount 1000000000

# Compensar contratista -> sub1
stellar contract invoke --id CDR3H3DNLWXRB46JUSFCBXSLFCU23RXYHJSFNWZQXQEGLXSKONT24AQY --source-account contratista --network testnet -- settle --debtor contratista --creditor sub1
```

Y enseñar el resultado en stellar.expert.

## Reiniciar los datos (para otra grabación o para el pitch del miércoles)

- **Opción rápida:** crear una factura nueva pendiente (`propose_invoice` desde sub2) y otra cruzada para volver a tener deuda que compensar.
- **Opción completa:** `.\scripts\deploy-demo.ps1 -Network testnet`. Crea un contrato **nuevo** con los datos originales y sobrescribe `demo-config.json`. Después hay que hacer commit y redeploy del frontend, y actualizar el ID en `docs/`.
