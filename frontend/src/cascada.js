// @pelamandarinas/cascada — cliente JS/TS del contrato Cascada.
//
// No hace falta generar bindings con el CLI: el cliente lee la interfaz (spec)
// del contrato desplegado en la red, así que siempre coincide con el contrato real.
//
// Lecturas (sin wallet):   const c = await createCascadaClient(config)
//                          const d = await loadDashboard(c, config)
// Escrituras (con wallet): const c = await createCascadaClient(config, { publicKey, signTransaction })
//                          await (await c.accept_invoice({ invoice_id: 3 })).signAndSend()

import { contract } from "@stellar/stellar-sdk";

/** 1 XLM = 10.000.000 stroops (7 decimales). */
export const STROOPS_PER_UNIT = 10_000_000n;
export const BPS_TOTAL = 10_000;

/** Códigos de error del contrato (enum Error en lib.rs). */
export const CascadaErrors = {
  1: "ProjectNotFound",
  2: "InvoiceNotFound",
  3: "InvalidAmount",
  4: "InvalidShare",
  5: "SharesExceed100",
  6: "NotMember",
  7: "InvalidStatus",
  8: "NothingToSettle",
  9: "SameParty",
  10: "TooManySubs",
  11: "DuplicateMember",
  12: "NotAllowedPayer",
};

/** Mensajes para mostrar en la interfaz. */
export const CascadaErrorMessages = {
  ProjectNotFound: "El proyecto no existe",
  InvoiceNotFound: "La factura no existe",
  InvalidAmount: "Importe no válido",
  InvalidShare: "Porcentaje no válido",
  SharesExceed100: "Los porcentajes superan el 100 %",
  NotMember: "Esa cuenta no forma parte del proyecto",
  InvalidStatus: "La factura ya fue aceptada o rechazada",
  NothingToSettle: "No hay deuda neta que compensar",
  SameParty: "Emisor y pagador no pueden ser la misma cuenta",
  TooManySubs: "Demasiadas subcontratas",
  DuplicateMember: "Esa cuenta ya está en el proyecto",
  NotAllowedPayer: "Solo el cliente o el contratista pueden liberar pagos",
};

/**
 * Crea el cliente del contrato.
 * @param {{contractId:string, rpcUrl:string, networkPassphrase:string}} config  demo-config.json
 * @param {{publicKey?:string, signTransaction?:Function}} [wallet]  necesario solo para escribir
 */
export async function createCascadaClient(config, wallet = {}) {
  return contract.Client.from({
    contractId: config.contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    allowHttp: config.rpcUrl.startsWith("http://"),
    ...wallet,
  });
}

/** Nombre del estado de una factura ("Proposed" | "Accepted" | "Rejected"). */
export function invoiceStatus(invoice) {
  const s = invoice.status;
  if (typeof s === "string") return s;
  if (Array.isArray(s)) return s[0];
  return s?.tag;
}

/** 500000000n -> "50" ; 123456789n -> "12.3456789" */
export function formatAmount(stroops) {
  const v = BigInt(stroops);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / STROOPS_PER_UNIT;
  const frac = (abs % STROOPS_PER_UNIT).toString().padStart(7, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toString() + (frac ? "." + frac : "");
}

/** "50" -> 500000000n ; "12.5" -> 125000000n */
export function parseAmount(text) {
  const [w, f = ""] = String(text).trim().split(".");
  if (f.length > 7) throw new Error("Máximo 7 decimales");
  return BigInt(w || "0") * STROOPS_PER_UNIT + BigInt((f + "0000000").slice(0, 7));
}

/** SHA-256 de un fichero (p. ej. el PDF de la factura) como Buffer de 32 bytes para doc_hash. */
export async function sha256OfFile(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return toBuffer(new Uint8Array(digest));
}

function toBuffer(bytes) {
  // El SDK espera Buffer; en el navegador lo trae su polyfill.
  const B = globalThis.Buffer;
  return B ? B.from(bytes) : bytes;
}

/** Hash como texto hex (para mostrarlo / compararlo). */
export function hashToHex(docHash) {
  const bytes = docHash?.data ?? docHash;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Error del contrato con código y mensaje legible. */
export class CascadaError extends Error {
  constructor(raw) {
    const info = decodeCascadaError(raw);
    super(info ? info.message : String(raw).split("\n")[0]);
    this.name = "CascadaError";
    this.code = info?.code ?? null;
    this.contractError = info?.name ?? null;
    this.raw = raw;
  }
}

/**
 * Ejecuta una lectura y devuelve el resultado; si el contrato falla lanza CascadaError.
 *   const project = await call(client.get_project({ project_id: 1 }))
 * (El SDK no lanza excepción en las lecturas que fallan: devuelve un objeto { error }).
 */
export async function call(txPromise) {
  const tx = await txPromise;
  const simError = tx.simulation && "error" in tx.simulation ? tx.simulation.error : null;
  if (simError) throw new CascadaError(simError);
  return tx.result;
}

/** Traduce un error de simulación/envío a { code, name, message } si es del contrato. */
export function decodeCascadaError(err) {
  const text = String(err?.raw ?? err?.message ?? err);
  const m = text.match(/Error\(Contract, #(\d+)\)/);
  if (!m) return null;
  const code = Number(m[1]);
  const name = CascadaErrors[code] ?? "Unknown";
  return { code, name, message: CascadaErrorMessages[name] ?? name };
}

/**
 * Carga todo lo que necesita el panel "tengo / debo" sin wallet:
 * proyecto, facturas del proyecto y deudas netas entre cada par de miembros.
 */
export async function loadDashboard(client, config, projectId = config.projectId ?? 1) {
  const names = invertAccounts(config.accounts ?? {});
  const label = (addr) => names[addr] ?? short(addr);

  const project = await call(client.get_project({ project_id: projectId }));
  const members = [project.client, project.contractor, ...project.shares.map((s) => s.sub)];

  const count = await call(client.invoice_count());
  const invoices = [];
  for (let id = 1; id <= count; id++) {
    const inv = await call(client.get_invoice({ invoice_id: id }));
    if (inv.project_id !== projectId) continue;
    invoices.push({
      id,
      ...inv,
      status: invoiceStatus(inv),
      issuerName: label(inv.issuer),
      payerName: label(inv.payer),
      amountText: formatAmount(inv.amount),
      docHashHex: hashToHex(inv.doc_hash),
    });
  }

  // Deuda neta entre cada par (positivo = from debe a to).
  const debts = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      const net = BigInt(await call(client.net_position({ a, b })));
      if (net === 0n) continue;
      const [from, to, amount] = net > 0n ? [a, b, net] : [b, a, -net];
      debts.push({ from, to, fromName: label(from), toName: label(to), amount, amountText: formatAmount(amount) });
    }
  }

  // Balance por miembro: positivo = le deben (tengo), negativo = debe (debo).
  const balances = members.map((addr) => {
    let bal = 0n;
    for (const d of debts) {
      if (d.to === addr) bal += d.amount;
      if (d.from === addr) bal -= d.amount;
    }
    return { address: addr, name: label(addr), balance: bal, balanceText: formatAmount(bal) };
  });

  return {
    projectId,
    project: {
      ...project,
      clientName: label(project.client),
      contractorName: label(project.contractor),
      releasedText: formatAmount(project.released),
      shares: project.shares.map((s) => ({ ...s, name: label(s.sub), percent: s.bps / 100 })),
    },
    invoices,
    debts,
    balances,
  };
}

function invertAccounts(accounts) {
  const out = {};
  for (const [name, addr] of Object.entries(accounts)) out[addr] = name;
  return out;
}

function short(addr) {
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}
