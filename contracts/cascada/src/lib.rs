//! Cascada — pagos transparentes en cadenas de subcontratación.
//!
//! Flujo:
//! 1. El contratista crea un proyecto con su cliente y añade subcontratas con un
//!    porcentaje (en puntos básicos: 10_000 = 100 %).
//! 2. Facturas con doble firma: quien cobra la propone (con el hash del PDF) y quien
//!    paga la acepta. Solo entonces cuenta como deuda.
//! 3. `release`: un pago entrante se reparte en cascada a las subcontratas en una
//!    sola transacción; el resto va al contratista.
//! 4. `settle`: compensa las deudas cruzadas entre dos empresas y paga solo el neto.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    token::TokenClient, Address, BytesN, Env, Vec,
};

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_TO: u32 = 120 * DAY_IN_LEDGERS;

/// 100 % expresado en puntos básicos.
pub const BPS_TOTAL: u32 = 10_000;
/// Límite de subcontratas por proyecto (acota el coste de `release`).
pub const MAX_SUBS: u32 = 20;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    ProjectCount,
    Project(u32),
    InvoiceCount,
    Invoice(u32),
    /// Deuda aceptada: (deudor, acreedor) -> importe.
    Debt(Address, Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Share {
    pub sub: Address,
    pub bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Project {
    pub client: Address,
    pub contractor: Address,
    pub shares: Vec<Share>,
    pub total_bps: u32,
    pub released: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InvoiceStatus {
    Proposed,
    Accepted,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Invoice {
    pub project_id: u32,
    /// Quien cobra (propone la factura).
    pub issuer: Address,
    /// Quien paga (debe aceptarla).
    pub payer: Address,
    pub amount: i128,
    /// SHA-256 del PDF de la factura.
    pub doc_hash: BytesN<32>,
    pub status: InvoiceStatus,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    ProjectNotFound = 1,
    InvoiceNotFound = 2,
    InvalidAmount = 3,
    InvalidShare = 4,
    SharesExceed100 = 5,
    NotMember = 6,
    InvalidStatus = 7,
    NothingToSettle = 8,
    SameParty = 9,
    TooManySubs = 10,
    DuplicateMember = 11,
    NotAllowedPayer = 12,
}

// ---------------------------------------------------------------------------
// Eventos (los lee el frontend para mostrar la actividad en directo)
// ---------------------------------------------------------------------------

#[contractevent]
pub struct ProjectCreated {
    #[topic]
    pub project_id: u32,
    pub client: Address,
    pub contractor: Address,
}

#[contractevent]
pub struct SubAdded {
    #[topic]
    pub project_id: u32,
    pub sub: Address,
    pub bps: u32,
}

#[contractevent]
pub struct InvoiceProposed {
    #[topic]
    pub invoice_id: u32,
    #[topic]
    pub payer: Address,
    pub issuer: Address,
    pub amount: i128,
}

#[contractevent]
pub struct InvoiceAccepted {
    #[topic]
    pub invoice_id: u32,
    pub amount: i128,
}

#[contractevent]
pub struct InvoiceRejected {
    #[topic]
    pub invoice_id: u32,
}

#[contractevent]
pub struct Payout {
    #[topic]
    pub project_id: u32,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
pub struct Released {
    #[topic]
    pub project_id: u32,
    pub payer: Address,
    pub amount: i128,
}

#[contractevent]
pub struct Settled {
    #[topic]
    pub debtor: Address,
    #[topic]
    pub creditor: Address,
    pub net: i128,
}

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

#[contract]
pub struct Cascada;

#[contractimpl]
impl Cascada {
    /// Se ejecuta una sola vez al desplegar. `token` = dirección del SAC de USDC.
    pub fn __constructor(env: Env, token: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::ProjectCount, &0u32);
        env.storage().instance().set(&DataKey::InvoiceCount, &0u32);
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    // ----------------------------- Proyectos -----------------------------

    /// El contratista crea el proyecto con su cliente. Devuelve el id.
    pub fn create_project(env: Env, client: Address, contractor: Address) -> u32 {
        contractor.require_auth();
        if client == contractor {
            panic_with_error!(&env, Error::SameParty);
        }
        bump_instance(&env);

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProjectCount)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DataKey::ProjectCount, &id);

        let project = Project {
            client: client.clone(),
            contractor: contractor.clone(),
            shares: Vec::new(&env),
            total_bps: 0,
            released: 0,
        };
        save_project(&env, id, &project);

        ProjectCreated {
            project_id: id,
            client,
            contractor,
        }
        .publish(&env);
        id
    }

    /// El contratista añade una subcontrata con su porcentaje (bps).
    pub fn add_subcontractor(env: Env, project_id: u32, sub: Address, bps: u32) {
        let mut project = load_project(&env, project_id);
        project.contractor.require_auth();
        bump_instance(&env);

        if bps == 0 || bps > BPS_TOTAL {
            panic_with_error!(&env, Error::InvalidShare);
        }
        if project.total_bps + bps > BPS_TOTAL {
            panic_with_error!(&env, Error::SharesExceed100);
        }
        if project.shares.len() >= MAX_SUBS {
            panic_with_error!(&env, Error::TooManySubs);
        }
        if is_member(&project, &sub) {
            panic_with_error!(&env, Error::DuplicateMember);
        }

        project.shares.push_back(Share {
            sub: sub.clone(),
            bps,
        });
        project.total_bps += bps;
        save_project(&env, project_id, &project);

        SubAdded {
            project_id,
            sub,
            bps,
        }
        .publish(&env);
    }

    pub fn get_project(env: Env, project_id: u32) -> Project {
        load_project(&env, project_id)
    }

    pub fn project_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ProjectCount)
            .unwrap_or(0)
    }

    // ------------------------------ Facturas -----------------------------

    /// Quien cobra propone una factura a otro miembro del proyecto.
    pub fn propose_invoice(
        env: Env,
        project_id: u32,
        issuer: Address,
        payer: Address,
        amount: i128,
        doc_hash: BytesN<32>,
    ) -> u32 {
        issuer.require_auth();
        bump_instance(&env);

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if issuer == payer {
            panic_with_error!(&env, Error::SameParty);
        }
        let project = load_project(&env, project_id);
        if !is_member(&project, &issuer) || !is_member(&project, &payer) {
            panic_with_error!(&env, Error::NotMember);
        }

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::InvoiceCount)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DataKey::InvoiceCount, &id);

        let invoice = Invoice {
            project_id,
            issuer: issuer.clone(),
            payer: payer.clone(),
            amount,
            doc_hash,
            status: InvoiceStatus::Proposed,
        };
        save_invoice(&env, id, &invoice);

        InvoiceProposed {
            invoice_id: id,
            payer,
            issuer,
            amount,
        }
        .publish(&env);
        id
    }

    /// Quien paga acepta la factura: a partir de aquí es deuda reconocida.
    pub fn accept_invoice(env: Env, invoice_id: u32) {
        let mut invoice = load_invoice(&env, invoice_id);
        invoice.payer.require_auth();
        bump_instance(&env);

        if invoice.status != InvoiceStatus::Proposed {
            panic_with_error!(&env, Error::InvalidStatus);
        }
        invoice.status = InvoiceStatus::Accepted;
        save_invoice(&env, invoice_id, &invoice);

        let current = read_debt(&env, &invoice.payer, &invoice.issuer);
        let updated = current
            .checked_add(invoice.amount)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidAmount));
        write_debt(&env, &invoice.payer, &invoice.issuer, updated);

        InvoiceAccepted {
            invoice_id,
            amount: invoice.amount,
        }
        .publish(&env);
    }

    /// Quien paga rechaza la factura.
    pub fn reject_invoice(env: Env, invoice_id: u32) {
        let mut invoice = load_invoice(&env, invoice_id);
        invoice.payer.require_auth();
        bump_instance(&env);

        if invoice.status != InvoiceStatus::Proposed {
            panic_with_error!(&env, Error::InvalidStatus);
        }
        invoice.status = InvoiceStatus::Rejected;
        save_invoice(&env, invoice_id, &invoice);

        InvoiceRejected { invoice_id }.publish(&env);
    }

    pub fn get_invoice(env: Env, invoice_id: u32) -> Invoice {
        load_invoice(&env, invoice_id)
    }

    pub fn invoice_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::InvoiceCount)
            .unwrap_or(0)
    }

    // ------------------------------ Pagos --------------------------------

    /// Pago en cascada: `payer` (cliente o contratista) paga `amount` y el contrato
    /// lo reparte en la misma transacción. Cada subcontrata recibe su %, y el resto
    /// va al contratista (si quien paga no es el propio contratista).
    pub fn release(env: Env, project_id: u32, payer: Address, amount: i128) {
        payer.require_auth();
        bump_instance(&env);

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let mut project = load_project(&env, project_id);
        if payer != project.client && payer != project.contractor {
            panic_with_error!(&env, Error::NotAllowedPayer);
        }

        let token = TokenClient::new(&env, &Self::token(env.clone()));
        let mut paid_to_subs: i128 = 0;

        for share in project.shares.iter() {
            let part = amount
                .checked_mul(share.bps as i128)
                .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidAmount))
                / (BPS_TOTAL as i128);
            if part > 0 {
                token.transfer(&payer, &share.sub, &part);
                paid_to_subs += part;
                Payout {
                    project_id,
                    to: share.sub.clone(),
                    amount: part,
                }
                .publish(&env);
            }
        }

        // Lo que queda (incluido el redondeo) es para el contratista.
        let remainder = amount - paid_to_subs;
        if remainder > 0 && payer != project.contractor {
            token.transfer(&payer, &project.contractor, &remainder);
            Payout {
                project_id,
                to: project.contractor.clone(),
                amount: remainder,
            }
            .publish(&env);
        }

        project.released = project
            .released
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidAmount));
        save_project(&env, project_id, &project);

        Released {
            project_id,
            payer,
            amount,
        }
        .publish(&env);
    }

    /// Deuda aceptada de `debtor` hacia `creditor`.
    pub fn debt_of(env: Env, debtor: Address, creditor: Address) -> i128 {
        read_debt(&env, &debtor, &creditor)
    }

    /// Posición neta: positivo = `a` debe a `b`; negativo = `b` debe a `a`.
    pub fn net_position(env: Env, a: Address, b: Address) -> i128 {
        read_debt(&env, &a, &b) - read_debt(&env, &b, &a)
    }

    /// Compensación: se cancelan las deudas cruzadas y `debtor` paga solo el neto.
    pub fn settle(env: Env, debtor: Address, creditor: Address) -> i128 {
        debtor.require_auth();
        bump_instance(&env);

        if debtor == creditor {
            panic_with_error!(&env, Error::SameParty);
        }
        let owed = read_debt(&env, &debtor, &creditor);
        let owed_back = read_debt(&env, &creditor, &debtor);
        let net = owed - owed_back;
        if net <= 0 {
            panic_with_error!(&env, Error::NothingToSettle);
        }

        // Efectos antes de la llamada externa.
        write_debt(&env, &debtor, &creditor, 0);
        write_debt(&env, &creditor, &debtor, 0);

        let token = TokenClient::new(&env, &Self::token(env.clone()));
        token.transfer(&debtor, &creditor, &net);

        Settled {
            debtor,
            creditor,
            net,
        }
        .publish(&env);
        net
    }
}

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_TO);
}

fn is_member(project: &Project, who: &Address) -> bool {
    if *who == project.client || *who == project.contractor {
        return true;
    }
    project.shares.iter().any(|s| s.sub == *who)
}

fn load_project(env: &Env, id: u32) -> Project {
    let key = DataKey::Project(id);
    let project: Project = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with_error!(env, Error::ProjectNotFound));
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_TO);
    project
}

fn save_project(env: &Env, id: u32, project: &Project) {
    let key = DataKey::Project(id);
    env.storage().persistent().set(&key, project);
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_TO);
}

fn load_invoice(env: &Env, id: u32) -> Invoice {
    let key = DataKey::Invoice(id);
    let invoice: Invoice = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvoiceNotFound));
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_TO);
    invoice
}

fn save_invoice(env: &Env, id: u32, invoice: &Invoice) {
    let key = DataKey::Invoice(id);
    env.storage().persistent().set(&key, invoice);
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_TO);
}

fn read_debt(env: &Env, debtor: &Address, creditor: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Debt(debtor.clone(), creditor.clone()))
        .unwrap_or(0)
}

fn write_debt(env: &Env, debtor: &Address, creditor: &Address, amount: i128) {
    let key = DataKey::Debt(debtor.clone(), creditor.clone());
    if amount == 0 {
        env.storage().persistent().remove(&key);
    } else {
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_TO);
    }
}

mod test;
