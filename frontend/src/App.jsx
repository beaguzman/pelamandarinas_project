import { useCallback, useEffect, useState } from "react";
import { requestAccess, getNetworkDetails, signTransaction } from "@stellar/freighter-api";
import config from "./demo-config.json";
import { createCascadaClient, loadDashboard, parseAmount, decodeCascadaError } from "./cascada";
import "./App.css";

const EXPLORER = "https://stellar.expert/explorer/testnet";

// Business-facing names for the demo accounts in demo-config.json
const ROLE_LABEL = {
  cliente: "Client",
  contratista: "General contractor",
  sub1: "Subcontractor A",
  sub2: "Subcontractor B",
};

// What each party can do (shown once the wallet is connected)
const ROLE_HELP = {
  cliente: "You can release payments to the supply chain.",
  contratista: "You can release payments, approve or reject invoices addressed to you, and settle outstanding balances.",
  sub1: "View-only access in this demo.",
  sub2: "View-only access in this demo.",
};

const STATUS_LABEL = { Proposed: "Pending", Accepted: "Approved", Rejected: "Rejected" };

// English messages for the contract errors (the shared client returns Spanish ones)
const ERROR_EN = {
  ProjectNotFound: "Project not found.",
  InvoiceNotFound: "Invoice not found.",
  InvalidAmount: "Invalid amount.",
  InvalidShare: "Invalid share.",
  SharesExceed100: "Shares exceed 100%.",
  NotMember: "This account is not a party to the project.",
  InvalidStatus: "This invoice has already been approved or rejected.",
  NothingToSettle: "There is no net balance to settle.",
  SameParty: "Issuer and payer cannot be the same account.",
  TooManySubs: "Too many subcontractors.",
  DuplicateMember: "This account is already a party to the project.",
  NotAllowedPayer: "Only the client or the general contractor can release payments.",
};

const nameByAddress = Object.fromEntries(
  Object.entries(config.accounts ?? {}).map(([name, addr]) => [addr, name])
);

const roleOf = (name) => ROLE_LABEL[name] ?? name;
const short = (addr) => (addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "");
const fmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const toNumber = (text) => Number(String(text).replace(",", "."));

function friendlyError(e) {
  const contractError = decodeCascadaError(e);
  if (contractError) return ERROR_EN[contractError.name] ?? contractError.message;
  const text = String(e?.message ?? e);
  if (/reject|declin|denied|cancel/i.test(text)) return "Signature cancelled in Freighter.";
  if (/not installed/i.test(text)) return "Freighter not found. Install the extension and reload the page.";
  if (/decimales/i.test(text)) return "Amounts can have at most 7 decimal places.";
  return text;
}

export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [address, setAddress] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [amount, setAmount] = useState("100");

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

  async function connect() {
    setNotice(null);
    try {
      const access = await requestAccess();
      if (access.error) throw new Error(access.error.message ?? String(access.error));
      const net = await getNetworkDetails();
      if (net.error) throw new Error(net.error.message ?? String(net.error));
      if (net.networkPassphrase !== config.networkPassphrase) {
        setAddress(null);
        setNotice({ kind: "error", text: "Freighter is not on Testnet. Switch the network in Freighter and reconnect." });
        return;
      }
      setAddress(access.address);
    } catch (e) {
      setNotice({ kind: "error", text: friendlyError(e) });
    }
  }

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
      setNotice({ kind: "ok", text: `${actionName}: completed.`, hash });
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
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <span className="brand-name">Cascada Pay</span>
        </div>
        <div className="top-right">
          <span className="network">Stellar Testnet</span>
          {address ? (
            <button
              className="wallet-chip"
              onClick={connect}
              disabled={!!busy}
              title="Switch account in Freighter, then click here"
            >
              <span className="dot" aria-hidden="true" />
              {me ? roleOf(me) : short(address)}
              <span className="chip-action">Switch</span>
            </button>
          ) : (
            <button className="btn" onClick={connect}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      <section className="intro">
        <p className="eyebrow">Project {config.projectId ?? 1}</p>
        <h1>Supply-chain payments for multi-tier subcontracting</h1>
        <p className="muted">
          Every figure below is read directly from the Stellar ledger and can be independently verified by any party.
        </p>
        <p className="role-help">
          {address
            ? `Signed in as ${me ? roleOf(me) : "an external account"}. ${
                me ? ROLE_HELP[me] : "This account is not a party to the project: view-only access."
              }`
            : "Anyone with this link can review the project. Connect a wallet to act as the client or the general contractor."}
        </p>
      </section>

      {busy && (
        <p className="notice wait" role="status">
          {busy}: confirm in Freighter and wait a few seconds…
        </p>
      )}
      {notice && (
        <p className={`notice ${notice.kind}`} role="status">
          {notice.text}
          {notice.hash && (
            <a href={`${EXPLORER}/tx/${notice.hash}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
          )}
        </p>
      )}

      {loadError && (
        <div className="notice error">
          Could not load ledger data: {loadError}{" "}
          <button className="link-btn" onClick={refresh}>
            Retry
          </button>
        </div>
      )}
      {!data && !loadError && <p className="muted loading">Loading ledger data…</p>}

      {data && (
        <main>
          <Summary data={data} />
          <Release
            project={data.project}
            amount={amount}
            setAmount={setAmount}
            canPay={me === "cliente" || me === "contratista"}
            busy={busy}
            onPay={() =>
              run(`Release of ${amount} XLM`, (c) =>
                c.release({
                  project_id: data.projectId,
                  payer: address,
                  amount: parseAmount(String(amount).replace(",", ".")),
                })
              )
            }
          />
          <Invoices
            invoices={data.invoices}
            address={address}
            busy={busy}
            onAccept={(inv) => run(`Invoice #${inv.id} approval`, (c) => c.accept_invoice({ invoice_id: inv.id }))}
            onReject={(inv) => run(`Invoice #${inv.id} rejection`, (c) => c.reject_invoice({ invoice_id: inv.id }))}
          />
          <Balances
            balances={data.balances}
            debts={data.debts}
            address={address}
            busy={busy}
            onSettle={(d) =>
              run(`Settlement with ${roleOf(d.toName)}`, (c) => c.settle({ debtor: address, creditor: d.to }))
            }
          />
        </main>
      )}

      <footer className="muted">
        Smart contract{" "}
        <a href={`${EXPLORER}/contract/${config.contractId}`} target="_blank" rel="noreferrer">
          {short(config.contractId)}
        </a>{" "}
        on Stellar Testnet.
      </footer>
    </div>
  );
}

function Summary({ data }) {
  const pending = data.invoices.filter((i) => i.status === "Proposed").length;
  return (
    <section className="summary" aria-label="Overview">
      <div>
        <span className="stat">{data.project.releasedText}</span>
        <span className="stat-label">XLM released to date</span>
      </div>
      <div>
        <span className="stat">{pending}</span>
        <span className="stat-label">{pending === 1 ? "invoice awaiting approval" : "invoices awaiting approval"}</span>
      </div>
      <div>
        <span className="stat">{data.debts.length}</span>
        <span className="stat-label">{data.debts.length === 1 ? "outstanding balance" : "outstanding balances"}</span>
      </div>
    </section>
  );
}

function Release({ project, amount, setAmount, canPay, busy, onPay }) {
  const value = toNumber(amount);
  const valid = Number.isFinite(value) && value > 0;
  const subsPercent = project.shares.reduce((sum, s) => sum + s.percent, 0);
  const rows = [
    ...project.shares.map((s) => ({ name: s.name, percent: s.percent })),
    { name: project.contractorName, percent: 100 - subsPercent },
  ];

  return (
    <section className="block" aria-labelledby="release-title">
      <h2 id="release-title">Release payment</h2>
      <p className="muted">
        A single payment is split across the supply chain in one transaction, according to the agreed shares.
      </p>

      <label className="amount">
        <span className="sr-only">Amount in XLM</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <span className="unit">XLM</span>
      </label>

      <ul className="split">
        {rows.map((r) => (
          <li key={r.name}>
            <span className="split-name">{roleOf(r.name)}</span>
            <span className="bar" aria-hidden="true">
              <span style={{ width: `${r.percent}%` }} />
            </span>
            <span className="split-pct muted">{fmt(r.percent)}%</span>
            <span className="split-amount num">{valid ? fmt((value * r.percent) / 100) : "–"} XLM</span>
          </li>
        ))}
      </ul>

      <button className="btn wide" disabled={!canPay || !valid || !!busy} onClick={onPay}>
        Release {valid ? fmt(value) : ""} XLM
      </button>
      {!canPay && <p className="hint">Connect the client or general contractor wallet to release payments.</p>}
    </section>
  );
}

function Invoices({ invoices, address, busy, onAccept, onReject }) {
  return (
    <section className="block" aria-labelledby="invoices-title">
      <h2 id="invoices-title">Invoices</h2>
      <p className="muted">An invoice becomes a payable only once the paying party approves it on-chain.</p>
      <ul className="rows">
        {invoices.map((inv) => {
          const pending = inv.status === "Proposed";
          const myTurn = pending && address === inv.payer;
          return (
            <li key={inv.id} className={myTurn ? "row my-turn" : "row"}>
              <div className="row-main">
                <span className="row-title">
                  {roleOf(inv.issuerName)} <span className="arrow">→</span> {roleOf(inv.payerName)}
                </span>
                <span className="row-sub muted">
                  Invoice #{inv.id} · Document hash <code title={inv.docHashHex}>{inv.docHashHex.slice(0, 8)}</code>
                </span>
              </div>
              <span className="num row-amount">{inv.amountText} XLM</span>
              <div className="row-end">
                {myTurn ? (
                  <>
                    <button className="btn small" disabled={!!busy} onClick={() => onAccept(inv)}>
                      Approve
                    </button>
                    <button className="btn small ghost" disabled={!!busy} onClick={() => onReject(inv)}>
                      Reject
                    </button>
                  </>
                ) : (
                  <span className={`tag ${inv.status}`}>
                    {pending ? `Awaiting ${roleOf(inv.payerName).toLowerCase()}` : STATUS_LABEL[inv.status]}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Balances({ balances, debts, address, busy, onSettle }) {
  return (
    <section className="block" aria-labelledby="balances-title">
      <h2 id="balances-title">Outstanding balances</h2>
      <p className="muted">Cross-debts are netted automatically, so only the difference is ever paid.</p>

      {debts.length === 0 ? (
        <p className="empty">No outstanding balances.</p>
      ) : (
        <ul className="rows">
          {debts.map((d) => {
            const myTurn = address === d.from;
            return (
              <li key={d.from + d.to} className={myTurn ? "row my-turn" : "row"}>
                <div className="row-main">
                  <span className="row-title">
                    {roleOf(d.fromName)} <span className="arrow">→</span> {roleOf(d.toName)}
                  </span>
                  <span className="row-sub muted">Net amount owed</span>
                </div>
                <span className="num row-amount">{d.amountText} XLM</span>
                <div className="row-end">
                  {myTurn && (
                    <button className="btn small" disabled={!!busy} onClick={() => onSettle(d)}>
                      Settle
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h3>Net position by party</h3>
      <ul className="balances">
        {balances.map((b) => {
          const state = b.balance > 0n ? "gain" : b.balance < 0n ? "owe" : "even";
          return (
            <li key={b.address}>
              <span>{roleOf(b.name)}</span>
              <span className={`num ${state}`}>
                {state === "gain" ? "+" : state === "owe" ? "−" : ""}
                {state === "even" ? "0" : b.balanceText.replace("-", "")} XLM
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
