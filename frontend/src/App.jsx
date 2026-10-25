import { useCallback, useEffect, useState } from "react";
import { requestAccess, getNetworkDetails, signTransaction } from "@stellar/freighter-api";
import config from "./demo-config.json";
import { createCascadaClient, loadDashboard, parseAmount, decodeCascadaError } from "./cascada";
import "./App.css";

const EXPLORER = "https://stellar.expert/explorer/testnet";

// Nombres legibles para las cuentas de demo-config.json
const ROLE_LABEL = {
  cliente: "Cliente",
  contratista: "Contratista",
  sub1: "Subcontrata 1",
  sub2: "Subcontrata 2",
};

const STATUS_LABEL = {
  Proposed: "Pendiente",
  Accepted: "Aceptada",
  Rejected: "Rechazada",
};

const nameByAddress = Object.fromEntries(
  Object.entries(config.accounts ?? {}).map(([name, addr]) => [addr, name])
);

const roleOf = (name) => ROLE_LABEL[name] ?? name;
const short = (addr) => (addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "");
const fmt = (n) => n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
const toNumber = (text) => Number(String(text).replace(",", "."));

function friendlyError(e) {
  const contractError = decodeCascadaError(e);
  if (contractError) return contractError.message;
  const text = String(e?.message ?? e);
  if (/reject|declin|denied|cancel/i.test(text)) return "Has cancelado la firma en Freighter.";
  if (/not installed/i.test(text)) return "No se encuentra Freighter. Instala la extensión y recarga la página.";
  return text;
}

export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [address, setAddress] = useState(null);
  const [busy, setBusy] = useState(null); // nombre de la acción en curso
  const [notice, setNotice] = useState(null); // { kind: "ok" | "error", text, hash? }
  const [amount, setAmount] = useState("100");

  // Lee el contrato sin wallet (esto es lo que ve cualquiera con el link)
  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      const client = await createCascadaClient(config);
      setData(await loadDashboard(client, config));
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const me = address ? nameByAddress[address] ?? null : null;

  // Conecta Freighter (o vuelve a leer la cuenta activa si ya estaba conectado)
  async function connect() {
    setNotice(null);
    try {
      const access = await requestAccess();
      if (access.error) throw new Error(access.error.message ?? String(access.error));
      const net = await getNetworkDetails();
      if (net.error) throw new Error(net.error.message ?? String(net.error));
      if (net.networkPassphrase !== config.networkPassphrase) {
        setAddress(null);
        setNotice({
          kind: "error",
          text: "Freighter no está en Testnet. Cambia la red en Freighter (icono del globo) y vuelve a conectar.",
        });
        return;
      }
      setAddress(access.address);
    } catch (e) {
      setNotice({ kind: "error", text: friendlyError(e) });
    }
  }

  // Ejecuta una escritura: simula, abre Freighter para firmar, envía y recarga el panel
  async function run(actionName, buildTx) {
    setBusy(actionName);
    setNotice(null);
    try {
      const client = await createCascadaClient(config, {
        publicKey: address,
        signTransaction: async (xdr) => {
          const r = await signTransaction(xdr, { networkPassphrase: config.networkPassphrase, address });
          if (r.error) throw new Error(r.error.message ?? String(r.error));
          return r;
        },
      });
      const tx = await buildTx(client);
      const sent = await tx.signAndSend();
      const hash = sent?.sendTransactionResponse?.hash ?? sent?.getTransactionResponse?.txHash ?? null;
      setNotice({ kind: "ok", text: `${actionName}: hecho.`, hash });
      await refresh();
    } catch (e) {
      setNotice({ kind: "error", text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Obra {config.projectId ?? 1}: pagos en cascada</h1>
          <p className="lead">
            Cada pago del cliente llega a las subcontratas en la misma transacción, y una factura solo cuenta
            cuando la firman las dos partes.
          </p>
        </div>
        <div className="wallet">
          {address ? (
            <>
              <span className="who">
                <strong>{me ? roleOf(me) : "Cuenta externa"}</strong>
                <span className="addr">{short(address)}</span>
              </span>
              <button
                className="btn ghost"
                onClick={connect}
                disabled={!!busy}
                title="Cambia de cuenta en Freighter y pulsa aquí"
              >
                Cambiar cuenta
              </button>
            </>
          ) : (
            <button className="btn" onClick={connect}>
              Conectar Freighter
            </button>
          )}
        </div>
      </header>

      {busy && (
        <p className="notice wait" role="status">
          {busy}: firma en Freighter y espera unos segundos…
        </p>
      )}
      {notice && (
        <p className={`notice ${notice.kind}`} role="status">
          {notice.text}
          {notice.hash && (
            <a href={`${EXPLORER}/tx/${notice.hash}`} target="_blank" rel="noreferrer">
              Ver la transacción
            </a>
          )}
        </p>
      )}

      {loadError && (
        <div className="notice error">
          No se han podido leer los datos del contrato: {loadError}{" "}
          <button className="btn small ghost" onClick={refresh}>
            Reintentar
          </button>
        </div>
      )}
      {!data && !loadError && <p className="loading">Leyendo el contrato en Stellar testnet…</p>}

      {data && (
        <main className="grid">
          <Cascade
            project={data.project}
            amount={amount}
            setAmount={setAmount}
            canRelease={me === "cliente" || me === "contratista"}
            busy={busy}
            onRelease={() =>
              run(`Pago de ${amount} XLM en cascada`, (c) =>
                c.release({
                  project_id: data.projectId,
                  payer: address,
                  amount: parseAmount(String(amount).replace(",", ".")),
                })
              )
            }
          />
          <Balances
            balances={data.balances}
            debts={data.debts}
            address={address}
            busy={busy}
            onSettle={(d) =>
              run(`Saldar deuda con ${roleOf(d.toName)}`, (c) => c.settle({ debtor: address, creditor: d.to }))
            }
          />
          <Invoices
            invoices={data.invoices}
            address={address}
            busy={busy}
            onAccept={(inv) => run(`Aceptar factura ${inv.id}`, (c) => c.accept_invoice({ invoice_id: inv.id }))}
            onReject={(inv) => run(`Rechazar factura ${inv.id}`, (c) => c.reject_invoice({ invoice_id: inv.id }))}
          />
        </main>
      )}

      <footer>
        Contrato{" "}
        <a href={`${EXPLORER}/contract/${config.contractId}`} target="_blank" rel="noreferrer">
          {short(config.contractId)}
        </a>{" "}
        en Stellar testnet. Los datos se leen directamente de la blockchain, sin servidor intermedio.
      </footer>
    </div>
  );
}

function Cascade({ project, amount, setAmount, canRelease, busy, onRelease }) {
  const value = toNumber(amount);
  const valid = Number.isFinite(value) && value > 0;
  const subsPercent = project.shares.reduce((sum, s) => sum + s.percent, 0);
  const rows = [
    ...project.shares.map((s) => ({ name: s.name, percent: s.percent })),
    { name: project.contractorName, percent: 100 - subsPercent, rest: true },
  ];

  return (
    <section className="cascade" aria-labelledby="cascade-title">
      <h2 id="cascade-title">Pago en cascada</h2>
      <p className="muted">
        Liberado hasta ahora: <strong className="num">{project.releasedText} XLM</strong>
      </p>
      <div className="flow">
        <div className="node source">
          <span className="node-role">Paga el {roleOf(project.clientName).toLowerCase()}</span>
          <label className="amount">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Importe a pagar en XLM"
            />
            <span>XLM</span>
          </label>
        </div>
        <ul className="branches">
          {rows.map((r) => (
            <li key={r.name} className="branch">
              <span className="node-role">{roleOf(r.name)}</span>
              <span className="pct">
                {fmt(r.percent)} %{r.rest ? " (el resto)" : ""}
              </span>
              <span className="num">{valid ? fmt((value * r.percent) / 100) : "–"} XLM</span>
            </li>
          ))}
        </ul>
      </div>
      <button className="btn" disabled={!canRelease || !valid || !!busy} onClick={onRelease}>
        Pagar {valid ? fmt(value) : ""} XLM en cascada
      </button>
      {!canRelease && <p className="hint">Para pagar, conecta la cuenta del cliente o del contratista.</p>}
    </section>
  );
}

function Balances({ balances, debts, address, busy, onSettle }) {
  return (
    <section aria-labelledby="balances-title">
      <h2 id="balances-title">Quién debe a quién</h2>
      <p className="muted">Las deudas cruzadas se compensan: solo se paga la diferencia.</p>
      <ul className="balances">
        {balances.map((b) => {
          const state = b.balance > 0n ? "gain" : b.balance < 0n ? "owe" : "even";
          const text = state === "gain" ? "Tiene a favor" : state === "owe" ? "Debe" : "Sin deudas";
          return (
            <li key={b.address} className={`bal ${state}`}>
              <span className="bal-name">{roleOf(b.name)}</span>
              <span className="bal-state">{text}</span>
              <span className="num">{state === "even" ? "0" : b.balanceText.replace("-", "")} XLM</span>
            </li>
          );
        })}
      </ul>

      <h3>Deudas netas</h3>
      {debts.length === 0 ? (
        <p className="muted">No hay deudas pendientes entre los miembros.</p>
      ) : (
        <ul className="debts">
          {debts.map((d) => (
            <li key={d.from + d.to}>
              <span>
                <strong>{roleOf(d.fromName)}</strong> debe <strong className="num">{d.amountText} XLM</strong> a{" "}
                <strong>{roleOf(d.toName)}</strong>
              </span>
              {address === d.from && (
                <button className="btn small" disabled={!!busy} onClick={() => onSettle(d)}>
                  Saldar deuda
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Invoices({ invoices, address, busy, onAccept, onReject }) {
  return (
    <section aria-labelledby="invoices-title">
      <h2 id="invoices-title">Facturas</h2>
      <p className="muted">Una factura solo se convierte en deuda cuando quien paga la acepta con su firma.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nº</th>
              <th>Emite</th>
              <th>Paga</th>
              <th className="r">Importe</th>
              <th>Estado</th>
              <th>Huella del PDF</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const pending = inv.status === "Proposed";
              const iAmPayer = pending && address === inv.payer;
              return (
                <tr key={inv.id}>
                  <td className="num">{inv.id}</td>
                  <td>{roleOf(inv.issuerName)}</td>
                  <td>{roleOf(inv.payerName)}</td>
                  <td className="num r">{inv.amountText} XLM</td>
                  <td>
                    <span className={`status ${inv.status}`}>{STATUS_LABEL[inv.status] ?? inv.status}</span>
                  </td>
                  <td>
                    <code title={inv.docHashHex}>{inv.docHashHex.slice(0, 10)}…</code>
                  </td>
                  <td>
                    <div className="actions">
                      {iAmPayer ? (
                        <>
                          <button className="btn small" disabled={!!busy} onClick={() => onAccept(inv)}>
                            Aceptar
                          </button>
                          <button className="btn small ghost" disabled={!!busy} onClick={() => onReject(inv)}>
                            Rechazar
                          </button>
                        </>
                      ) : pending ? (
                        <span className="hint">La firma {roleOf(inv.payerName).toLowerCase()}</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
