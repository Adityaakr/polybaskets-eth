use ::basket_market_app::{
    Basket, BasketItem, Config, Outcome, Position, Settlement, SettlementStatus,
};
use ::basket_market_client::{
    BasketMarketClient as _, BasketMarketClientCtors as _, basket_market::*,
};
use sails_rs::{client::*, gtest::*, prelude::*};

// Actors
const OPERATOR: u64 = 42; // deployer => owner
const SETTLER: u64 = 7;
const ALICE: u64 = 100;
const BOB: u64 = 101;

const LIVENESS_SECONDS: u64 = 1; // 1s => 1000ms challenge window

// Collateral discriminants on the ABI boundary
const ETH: u16 = 0;
const WVARA: u16 = 1;

type BmActor = sails_rs::client::Actor<::basket_market_client::BasketMarketClientProgram, GtestEnv>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn create_env() -> (GtestEnv, CodeId) {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");
    for actor in [OPERATOR, SETTLER, ALICE, BOB] {
        system.mint_to(actor, 1_000_000_000_000_000);
    }
    let code_id = system.submit_code(::basket_market::WASM_BINARY);
    let env = GtestEnv::new(system, OPERATOR.into());
    (env, code_id)
}

async fn deploy(env: &GtestEnv, code_id: CodeId, salt: &[u8]) -> BmActor {
    deploy_with_liveness(env, code_id, salt, LIVENESS_SECONDS).await
}

async fn deploy_with_liveness(
    env: &GtestEnv,
    code_id: CodeId,
    salt: &[u8],
    liveness_seconds: u64,
) -> BmActor {
    env.deploy::<::basket_market_client::BasketMarketClientProgram>(code_id, salt.to_vec())
        .init(SETTLER.into(), liveness_seconds)
        .await
        .unwrap()
}

fn two_leg_items() -> Vec<u8> {
    let items = vec![
        BasketItem {
            poly_market_id: "m1".into(),
            poly_slug: "slug-1".into(),
            weight_bps: 6000,
            selected_outcome: Outcome::Yes,
        },
        BasketItem {
            poly_market_id: "m2".into(),
            poly_slug: "slug-2".into(),
            weight_bps: 4000,
            selected_outcome: Outcome::No,
        },
    ];
    items.encode()
}

fn resolutions(outcomes: &[Outcome]) -> Vec<u8> {
    outcomes.to_vec().encode()
}

fn decode_basket(bytes: &[u8]) -> Basket {
    let mut s: &[u8] = bytes;
    Basket::decode(&mut s).expect("decode Basket")
}

fn decode_positions(bytes: &[u8]) -> Vec<Position> {
    let mut s: &[u8] = bytes;
    Vec::<Position>::decode(&mut s).expect("decode Vec<Position>")
}

fn decode_settlement(bytes: &[u8]) -> Option<Settlement> {
    let mut s: &[u8] = bytes;
    Option::<Settlement>::decode(&mut s).expect("decode Option<Settlement>")
}

fn decode_config(bytes: &[u8]) -> Config {
    let mut s: &[u8] = bytes;
    Config::decode(&mut s).expect("decode Config")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn deposit_credits_ledger_and_config_is_set() {
    let (env, code_id) = create_env();
    let program = deploy(&env, code_id, b"deposit").await;

    let cfg = decode_config(&program.basket_market().get_config().await.unwrap());
    assert_eq!(cfg.owner, OPERATOR.into());
    assert_eq!(cfg.settler_role, SETTLER.into());
    assert_eq!(cfg.liveness_seconds, LIVENESS_SECONDS);

    let new_bal: Result<u128, Error> = program
        .basket_market()
        .deposit_eth()
        .with_actor_id(ALICE.into())
        .with_value(1_000)
        .await
        .unwrap();
    assert_eq!(new_bal, Ok(1_000));

    let bal: Result<u128, Error> = program
        .basket_market()
        .get_balance(ALICE.into(), ETH)
        .await
        .unwrap();
    assert_eq!(bal, Ok(1_000));

    // wVARA deposit credits the Wvara ledger independently.
    let wbal: Result<u128, Error> = program
        .basket_market()
        .deposit_wvara(500)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(wbal, Ok(500));
    let bal_w: Result<u128, Error> = program
        .basket_market()
        .get_balance(ALICE.into(), WVARA)
        .await
        .unwrap();
    assert_eq!(bal_w, Ok(500));
}

#[tokio::test]
async fn create_basket_validates_and_stores() {
    let (env, code_id) = create_env();
    let program = deploy(&env, code_id, b"create").await;

    let id: Result<u64, Error> = program
        .basket_market()
        .create_basket("My Basket".into(), "desc".into(), two_leg_items())
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(id, Ok(0));
    assert_eq!(program.basket_market().get_basket_count().await.unwrap(), 1);

    let basket = decode_basket(&program.basket_market().get_basket(0).await.unwrap().unwrap());
    assert_eq!(basket.id, 0);
    assert_eq!(basket.items.len(), 2);
    assert_eq!(basket.creator, ALICE.into());

    // Bad weights (sum != 10000) rejected.
    let bad_items = vec![BasketItem {
        poly_market_id: "x".into(),
        poly_slug: "x".into(),
        weight_bps: 5000,
        selected_outcome: Outcome::Yes,
    }]
    .encode();
    let bad: Result<u64, Error> = program
        .basket_market()
        .create_basket("Bad".into(), "d".into(), bad_items)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(bad, Err(Error::InvalidWeights));
}

#[tokio::test]
async fn bet_debits_ledger_and_mints_shares() {
    let (env, code_id) = create_env();
    let program = deploy(&env, code_id, b"bet").await;

    program
        .basket_market()
        .deposit_eth()
        .with_actor_id(ALICE.into())
        .with_value(1_000)
        .await
        .unwrap();
    program
        .basket_market()
        .create_basket("B".into(), "d".into(), two_leg_items())
        .with_actor_id(ALICE.into())
        .await
        .unwrap();

    let shares: Result<u128, Error> = program
        .basket_market()
        .bet_on_basket(0, ETH, 600, 5000)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(shares, Ok(600));

    // Ledger debited.
    let bal: Result<u128, Error> = program
        .basket_market()
        .get_balance(ALICE.into(), ETH)
        .await
        .unwrap();
    assert_eq!(bal, Ok(400));

    let positions = decode_positions(
        &program
            .basket_market()
            .get_positions(ALICE.into())
            .await
            .unwrap(),
    );
    assert_eq!(positions.len(), 1);
    assert_eq!(positions[0].shares, 600);
    assert_eq!(positions[0].index_at_creation_bps, 5000);
    assert!(!positions[0].claimed);

    // Insufficient balance rejected.
    let over: Result<u128, Error> = program
        .basket_market()
        .bet_on_basket(0, ETH, 10_000, 5000)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(over, Err(Error::InsufficientBalance));
}

#[tokio::test]
async fn winner_is_paid_from_pool() {
    let (env, code_id) = create_env();
    let program = deploy(&env, code_id, b"winner").await;

    // Operator seeds the ETH pool with 10_000 (sender defaults to OPERATOR).
    let pool: Result<u128, Error> = program
        .basket_market()
        .seed_pool_eth()
        .with_value(10_000)
        .await
        .unwrap();
    assert_eq!(pool, Ok(10_000));

    // Alice deposits and bets 1000 at entry index 5000.
    program
        .basket_market()
        .deposit_eth()
        .with_actor_id(ALICE.into())
        .with_value(1_000)
        .await
        .unwrap();
    program
        .basket_market()
        .create_basket("B".into(), "d".into(), two_leg_items())
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    program
        .basket_market()
        .bet_on_basket(0, ETH, 1_000, 5000)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();

    // Settle at index 10000 => payout = 1000 * 10000 / 5000 = 2000 (winner).
    program
        .basket_market()
        .propose_settlement(0, resolutions(&[Outcome::Yes, Outcome::No]), 10_000)
        .with_actor_id(SETTLER.into())
        .await
        .unwrap();
    env.run_next_block(); // advance past challenge window
    let fin: Result<(), Error> = program
        .basket_market()
        .finalize_settlement(0)
        .with_actor_id(SETTLER.into())
        .await
        .unwrap();
    assert_eq!(fin, Ok(()));

    let payout: Result<u128, Error> = program
        .basket_market()
        .claim(0)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(payout, Ok(2_000));

    // Ledger credited with payout (0 free after bet + 2000 payout).
    let bal: Result<u128, Error> = program
        .basket_market()
        .get_balance(ALICE.into(), ETH)
        .await
        .unwrap();
    assert_eq!(bal, Ok(2_000));

    // Pool funded the net 1000 winnings: 10_000 - (2000 - 1000) = 9_000.
    let pool_after: Result<u128, Error> = program.basket_market().get_pool(ETH).await.unwrap();
    assert_eq!(pool_after, Ok(9_000));

    // Double-claim rejected.
    let again: Result<u128, Error> = program
        .basket_market()
        .claim(0)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(again, Err(Error::AlreadyClaimed));
}

#[tokio::test]
async fn loser_stake_flows_into_pool() {
    let (env, code_id) = create_env();
    let program = deploy(&env, code_id, b"loser").await;

    program
        .basket_market()
        .deposit_eth()
        .with_actor_id(BOB.into())
        .with_value(1_000)
        .await
        .unwrap();
    program
        .basket_market()
        .create_basket("B".into(), "d".into(), two_leg_items())
        .with_actor_id(BOB.into())
        .await
        .unwrap();
    // Bet 1000 at entry index 8000.
    program
        .basket_market()
        .bet_on_basket(0, ETH, 1_000, 8000)
        .with_actor_id(BOB.into())
        .await
        .unwrap();

    // Settle at index 0 => total loss, payout = 0.
    program
        .basket_market()
        .propose_settlement(0, resolutions(&[Outcome::No, Outcome::Yes]), 0)
        .with_actor_id(SETTLER.into())
        .await
        .unwrap();
    env.run_next_block();
    program
        .basket_market()
        .finalize_settlement(0)
        .with_actor_id(SETTLER.into())
        .await
        .unwrap();

    let payout: Result<u128, Error> = program
        .basket_market()
        .claim(0)
        .with_actor_id(BOB.into())
        .await
        .unwrap();
    assert_eq!(payout, Ok(0));

    // The full stake (1000) flowed into the pool.
    let pool_after: Result<u128, Error> = program.basket_market().get_pool(ETH).await.unwrap();
    assert_eq!(pool_after, Ok(1_000));

    // Bob's free balance stays at 0 (staked, lost).
    let bal: Result<u128, Error> = program
        .basket_market()
        .get_balance(BOB.into(), ETH)
        .await
        .unwrap();
    assert_eq!(bal, Ok(0));
}

#[tokio::test]
async fn pool_insufficient_guard_blocks_overpayment() {
    let (env, code_id) = create_env();
    let program = deploy(&env, code_id, b"poolguard").await;

    // No pool seeding. Alice bets 1000 @ index 5000, settles @ 10000 => wants
    // net 1000 from an empty pool.
    program
        .basket_market()
        .deposit_eth()
        .with_actor_id(ALICE.into())
        .with_value(1_000)
        .await
        .unwrap();
    program
        .basket_market()
        .create_basket("B".into(), "d".into(), two_leg_items())
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    program
        .basket_market()
        .bet_on_basket(0, ETH, 1_000, 5000)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();

    program
        .basket_market()
        .propose_settlement(0, resolutions(&[Outcome::Yes, Outcome::No]), 10_000)
        .with_actor_id(SETTLER.into())
        .await
        .unwrap();
    env.run_next_block();
    program
        .basket_market()
        .finalize_settlement(0)
        .with_actor_id(SETTLER.into())
        .await
        .unwrap();

    let claim_res: Result<u128, Error> = program
        .basket_market()
        .claim(0)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(claim_res, Err(Error::PoolInsufficient));
}

#[tokio::test]
async fn withdraw_debits_ledger_and_egresses() {
    let (env, code_id) = create_env();
    let program = deploy(&env, code_id, b"withdraw").await;

    program
        .basket_market()
        .deposit_eth()
        .with_actor_id(ALICE.into())
        .with_value(1_000)
        .await
        .unwrap();

    let w: Result<(), Error> = program
        .basket_market()
        .withdraw_eth(400)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(w, Ok(()));

    let bal: Result<u128, Error> = program
        .basket_market()
        .get_balance(ALICE.into(), ETH)
        .await
        .unwrap();
    assert_eq!(bal, Ok(600));

    // Over-withdraw rejected.
    let over: Result<(), Error> = program
        .basket_market()
        .withdraw_eth(10_000)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(over, Err(Error::InsufficientBalance));
}

#[tokio::test]
async fn settlement_challenge_window_is_enforced() {
    let (env, code_id) = create_env();
    // Use a 60s window (= 20 gtest blocks at 3s/block) so a small number of
    // intervening blocks (each PendingCall advances ~1 block) cannot finalize
    // prematurely. We then explicitly advance well past it.
    let window_seconds = 60u64;
    let program = deploy_with_liveness(&env, code_id, b"window", window_seconds).await;

    program
        .basket_market()
        .create_basket("B".into(), "d".into(), two_leg_items())
        .with_actor_id(ALICE.into())
        .await
        .unwrap();

    program
        .basket_market()
        .propose_settlement(0, resolutions(&[Outcome::Yes, Outcome::No]), 10_000)
        .with_actor_id(SETTLER.into())
        .await
        .unwrap();

    // Settlement recorded as Proposed.
    let s = decode_settlement(&program.basket_market().get_settlement(0).await.unwrap()).unwrap();
    assert_eq!(s.status, SettlementStatus::Proposed);

    // Finalizing before the deadline fails.
    let early: Result<(), Error> = program
        .basket_market()
        .finalize_settlement(0)
        .with_actor_id(SETTLER.into())
        .await
        .unwrap();
    assert_eq!(early, Err(Error::ChallengeDeadlineNotPassed));

    // Advance well past the 60s window (25 blocks * 3s = 75s), then finalize.
    for _ in 0..25 {
        env.run_next_block();
    }
    let ok: Result<(), Error> = program
        .basket_market()
        .finalize_settlement(0)
        .with_actor_id(SETTLER.into())
        .await
        .unwrap();
    assert_eq!(ok, Ok(()));

    let s2 = decode_settlement(&program.basket_market().get_settlement(0).await.unwrap()).unwrap();
    assert_eq!(s2.status, SettlementStatus::Finalized);
}

#[tokio::test]
async fn unauthorized_settler_and_operator_rejected() {
    let (env, code_id) = create_env();
    let program = deploy(&env, code_id, b"authz").await;

    program
        .basket_market()
        .create_basket("B".into(), "d".into(), two_leg_items())
        .with_actor_id(ALICE.into())
        .await
        .unwrap();

    // Alice is not the settler.
    let not_settler: Result<(), Error> = program
        .basket_market()
        .propose_settlement(0, resolutions(&[Outcome::Yes, Outcome::No]), 10_000)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(not_settler, Err(Error::Unauthorized));

    // Alice is not the operator: seeding the pool is rejected.
    let not_owner: Result<u128, Error> = program
        .basket_market()
        .seed_pool_eth()
        .with_actor_id(ALICE.into())
        .with_value(1_000)
        .await
        .unwrap();
    assert_eq!(not_owner, Err(Error::Unauthorized));

    // Alice cannot withdraw from the pool either (owner check runs first).
    let not_owner_wd: Result<(), Error> = program
        .basket_market()
        .withdraw_pool_eth(1)
        .with_actor_id(ALICE.into())
        .await
        .unwrap();
    assert_eq!(not_owner_wd, Err(Error::Unauthorized));
}
