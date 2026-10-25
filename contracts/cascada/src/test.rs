#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};

/// Entorno de prueba: un USDC de mentira (SAC), el contrato Cascada desplegado
/// y cuatro empresas: cliente, contratista y dos subcontratas.
struct Setup<'a> {
    env: Env,
    contract: CascadaClient<'a>,
    usdc: TokenClient<'a>,
    usdc_admin: StellarAssetClient<'a>,
    client: Address,
    contractor: Address,
    sub1: Address,
    sub2: Address,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token_addr = sac.address();

    let contract_id = env.register(Cascada, (token_addr.clone(),));

    Setup {
        contract: CascadaClient::new(&env, &contract_id),
        usdc: TokenClient::new(&env, &token_addr),
        usdc_admin: StellarAssetClient::new(&env, &token_addr),
        client: Address::generate(&env),
        contractor: Address::generate(&env),
        sub1: Address::generate(&env),
        sub2: Address::generate(&env),
        env,
    }
}

/// Las funciones del contrato no devuelven `Result`: hacen `panic_with_error!`,
/// así que los métodos `try_` devuelven el error convertido a `soroban_sdk::Error`.
fn err(e: Error) -> soroban_sdk::Error {
    e.into()
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Proyecto con sub1 al 30 % y sub2 al 20 %.
fn project_with_subs(s: &Setup) -> u32 {
    let id = s.contract.create_project(&s.client, &s.contractor);
    s.contract.add_subcontractor(&id, &s.sub1, &3_000);
    s.contract.add_subcontractor(&id, &s.sub2, &2_000);
    id
}

#[test]
fn create_project_and_add_subs() {
    let s = setup();
    let id = project_with_subs(&s);

    assert_eq!(id, 1);
    assert_eq!(s.contract.project_count(), 1);
    let p = s.contract.get_project(&id);
    assert_eq!(p.client, s.client);
    assert_eq!(p.contractor, s.contractor);
    assert_eq!(p.shares.len(), 2);
    assert_eq!(p.total_bps, 5_000);
}

#[test]
fn shares_cannot_exceed_100_percent() {
    let s = setup();
    let id = s.contract.create_project(&s.client, &s.contractor);
    s.contract.add_subcontractor(&id, &s.sub1, &8_000);

    let res = s.contract.try_add_subcontractor(&id, &s.sub2, &3_000);
    assert_eq!(res, Err(Ok(err(Error::SharesExceed100))));
}

#[test]
fn duplicate_member_rejected() {
    let s = setup();
    let id = s.contract.create_project(&s.client, &s.contractor);
    s.contract.add_subcontractor(&id, &s.sub1, &1_000);

    let res = s.contract.try_add_subcontractor(&id, &s.sub1, &1_000);
    assert_eq!(res, Err(Ok(err(Error::DuplicateMember))));
}

#[test]
fn invoice_needs_acceptance_to_become_debt() {
    let s = setup();
    let id = project_with_subs(&s);

    let inv = s
        .contract
        .propose_invoice(&id, &s.sub1, &s.contractor, &1_000, &hash(&s.env, 1));

    // Propuesta: todavía no es deuda.
    assert_eq!(s.contract.debt_of(&s.contractor, &s.sub1), 0);
    assert_eq!(
        s.contract.get_invoice(&inv).status,
        InvoiceStatus::Proposed
    );

    // Aceptada: deuda reconocida.
    s.contract.accept_invoice(&inv);
    assert_eq!(s.contract.debt_of(&s.contractor, &s.sub1), 1_000);
    assert_eq!(
        s.contract.get_invoice(&inv).status,
        InvoiceStatus::Accepted
    );

    // No se puede aceptar dos veces.
    assert_eq!(
        s.contract.try_accept_invoice(&inv),
        Err(Ok(err(Error::InvalidStatus)))
    );
}

#[test]
fn rejected_invoice_creates_no_debt() {
    let s = setup();
    let id = project_with_subs(&s);
    let inv = s
        .contract
        .propose_invoice(&id, &s.sub2, &s.contractor, &500, &hash(&s.env, 2));

    s.contract.reject_invoice(&inv);
    assert_eq!(s.contract.debt_of(&s.contractor, &s.sub2), 0);
    assert_eq!(
        s.contract.get_invoice(&inv).status,
        InvoiceStatus::Rejected
    );
}

#[test]
fn outsider_cannot_invoice() {
    let s = setup();
    let id = project_with_subs(&s);
    let outsider = Address::generate(&s.env);

    let res = s
        .contract
        .try_propose_invoice(&id, &outsider, &s.contractor, &100, &hash(&s.env, 3));
    assert_eq!(res, Err(Ok(err(Error::NotMember))));
}

#[test]
fn invalid_amount_rejected() {
    let s = setup();
    let id = project_with_subs(&s);
    let res = s
        .contract
        .try_propose_invoice(&id, &s.sub1, &s.contractor, &0, &hash(&s.env, 4));
    assert_eq!(res, Err(Ok(err(Error::InvalidAmount))));
}

#[test]
fn release_pays_everyone_in_cascade() {
    let s = setup();
    let id = project_with_subs(&s);
    s.usdc_admin.mint(&s.client, &10_000);

    s.contract.release(&id, &s.client, &10_000);

    assert_eq!(s.usdc.balance(&s.sub1), 3_000); // 30 %
    assert_eq!(s.usdc.balance(&s.sub2), 2_000); // 20 %
    assert_eq!(s.usdc.balance(&s.contractor), 5_000); // resto
    assert_eq!(s.usdc.balance(&s.client), 0);
    assert_eq!(s.contract.get_project(&id).released, 10_000);
}

#[test]
fn release_rounding_goes_to_contractor() {
    let s = setup();
    let id = project_with_subs(&s);
    s.usdc_admin.mint(&s.client, &999);

    s.contract.release(&id, &s.client, &999);

    // 999 * 30 % = 299 (redondeo hacia abajo), 999 * 20 % = 199
    assert_eq!(s.usdc.balance(&s.sub1), 299);
    assert_eq!(s.usdc.balance(&s.sub2), 199);
    assert_eq!(s.usdc.balance(&s.contractor), 501);
}

#[test]
fn contractor_can_forward_escrow_payment() {
    // Caso Trustless Work: el escrow libera al contratista y este ejecuta la cascada.
    let s = setup();
    let id = project_with_subs(&s);
    s.usdc_admin.mint(&s.contractor, &10_000);

    s.contract.release(&id, &s.contractor, &10_000);

    assert_eq!(s.usdc.balance(&s.sub1), 3_000);
    assert_eq!(s.usdc.balance(&s.sub2), 2_000);
    assert_eq!(s.usdc.balance(&s.contractor), 5_000);
}

#[test]
fn outsider_cannot_release() {
    let s = setup();
    let id = project_with_subs(&s);
    let outsider = Address::generate(&s.env);
    s.usdc_admin.mint(&outsider, &1_000);

    let res = s.contract.try_release(&id, &outsider, &1_000);
    assert_eq!(res, Err(Ok(err(Error::NotAllowedPayer))));
}

#[test]
fn settle_pays_only_the_net() {
    let s = setup();
    let id = project_with_subs(&s);

    // sub1 factura 1_000 al contratista; el contratista factura 400 a sub1.
    let a = s
        .contract
        .propose_invoice(&id, &s.sub1, &s.contractor, &1_000, &hash(&s.env, 5));
    s.contract.accept_invoice(&a);
    let b = s
        .contract
        .propose_invoice(&id, &s.contractor, &s.sub1, &400, &hash(&s.env, 6));
    s.contract.accept_invoice(&b);

    assert_eq!(s.contract.net_position(&s.contractor, &s.sub1), 600);

    s.usdc_admin.mint(&s.contractor, &600);
    let paid = s.contract.settle(&s.contractor, &s.sub1);

    assert_eq!(paid, 600);
    assert_eq!(s.usdc.balance(&s.sub1), 600);
    assert_eq!(s.usdc.balance(&s.contractor), 0);
    assert_eq!(s.contract.debt_of(&s.contractor, &s.sub1), 0);
    assert_eq!(s.contract.debt_of(&s.sub1, &s.contractor), 0);
}

#[test]
fn settle_with_nothing_owed_fails() {
    let s = setup();
    let res = s.contract.try_settle(&s.contractor, &s.sub1);
    assert_eq!(res, Err(Ok(err(Error::NothingToSettle))));
}
