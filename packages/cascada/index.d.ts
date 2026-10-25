import type { contract } from "@stellar/stellar-sdk";

type AssembledTransaction<T> = contract.AssembledTransaction<T>;
type u32 = number;
type i128 = bigint;
type Address = string;

export interface DemoConfig {
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  tokenId?: string;
  projectId?: number;
  accounts?: Record<string, Address>;
  deployedAt?: string;
}

export interface Share { sub: Address; bps: u32 }

export interface Project {
  client: Address;
  contractor: Address;
  shares: Share[];
  total_bps: u32;
  released: i128;
}

export type InvoiceStatusName = "Proposed" | "Accepted" | "Rejected";

export interface Invoice {
  project_id: u32;
  issuer: Address;
  payer: Address;
  amount: i128;
  /** SHA-256 del PDF (32 bytes) */
  doc_hash: Uint8Array;
  status: { tag: InvoiceStatusName } | InvoiceStatusName;
}

/** Métodos del contrato. Cada llamada simula; las escrituras se envían con `.signAndSend()`. */
export interface CascadaClient extends contract.Client {
  token(): Promise<AssembledTransaction<Address>>;
  create_project(a: { client: Address; contractor: Address }): Promise<AssembledTransaction<u32>>;
  add_subcontractor(a: { project_id: u32; sub: Address; bps: u32 }): Promise<AssembledTransaction<null>>;
  get_project(a: { project_id: u32 }): Promise<AssembledTransaction<Project>>;
  project_count(): Promise<AssembledTransaction<u32>>;
  propose_invoice(a: {
    project_id: u32; issuer: Address; payer: Address; amount: i128; doc_hash: Uint8Array;
  }): Promise<AssembledTransaction<u32>>;
  accept_invoice(a: { invoice_id: u32 }): Promise<AssembledTransaction<null>>;
  reject_invoice(a: { invoice_id: u32 }): Promise<AssembledTransaction<null>>;
  get_invoice(a: { invoice_id: u32 }): Promise<AssembledTransaction<Invoice>>;
  invoice_count(): Promise<AssembledTransaction<u32>>;
  release(a: { project_id: u32; payer: Address; amount: i128 }): Promise<AssembledTransaction<null>>;
  debt_of(a: { debtor: Address; creditor: Address }): Promise<AssembledTransaction<i128>>;
  /** positivo = `a` debe a `b`; negativo = `b` debe a `a` */
  net_position(a: { a: Address; b: Address }): Promise<AssembledTransaction<i128>>;
  settle(a: { debtor: Address; creditor: Address }): Promise<AssembledTransaction<i128>>;
}

export interface WalletOptions {
  publicKey?: string;
  signTransaction?: contract.ClientOptions["signTransaction"];
  signAuthEntry?: contract.ClientOptions["signAuthEntry"];
}

export const STROOPS_PER_UNIT: bigint;
export const BPS_TOTAL: number;
export const CascadaErrors: Record<number, string>;
export const CascadaErrorMessages: Record<string, string>;

export function createCascadaClient(config: DemoConfig, wallet?: WalletOptions): Promise<CascadaClient>;
export function invoiceStatus(invoice: Invoice): InvoiceStatusName;
export function formatAmount(stroops: bigint | number | string): string;
export function parseAmount(text: string): bigint;
export function sha256OfFile(file: Blob): Promise<Uint8Array>;
export function hashToHex(docHash: Uint8Array | { data: number[] }): string;
export class CascadaError extends Error {
  code: number | null;
  contractError: string | null;
  raw: unknown;
}
/** Lectura que lanza CascadaError si el contrato falla. */
export function call<T>(tx: Promise<AssembledTransaction<T>>): Promise<T>;
export function decodeCascadaError(err: unknown): { code: number; name: string; message: string } | null;

export interface DashboardInvoice extends Omit<Invoice, "status"> {
  id: number;
  status: InvoiceStatusName;
  issuerName: string;
  payerName: string;
  amountText: string;
  docHashHex: string;
}

export interface Dashboard {
  projectId: number;
  project: Project & {
    clientName: string;
    contractorName: string;
    releasedText: string;
    shares: (Share & { name: string; percent: number })[];
  };
  invoices: DashboardInvoice[];
  /** Deudas netas: `from` debe `amount` a `to` */
  debts: { from: Address; to: Address; fromName: string; toName: string; amount: bigint; amountText: string }[];
  /** positivo = le deben (tengo); negativo = debe (debo) */
  balances: { address: Address; name: string; balance: bigint; balanceText: string }[];
}

export function loadDashboard(client: CascadaClient, config: DemoConfig, projectId?: number): Promise<Dashboard>;
