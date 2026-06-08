#![no_std]

//! BasketMarket — PolyBaskets-ETH (Vara.eth / ethexe) Sails program.
//!
//! Economic model: OPERATOR-SEEDED HOUSE POOL.
//!
//! - A multi-collateral internal ledger holds each user's free balance per
//!   collateral (`ledger[(user, collateral)]`).
//! - A house pool per collateral (`pool[collateral]`) is seeded by the operator.
//!   Losers' net staked amounts flow INTO the pool; winners' net winnings are
//!   paid OUT of the pool.
//!
//! Value movement (deposit / withdraw / seed / withdraw-pool) happens over
//! classic value-carrying messages. Gameplay (create / bet / claim) is pure
//! ledger arithmetic with zero attached value, so it can ride the injected
//! pre-confirmed path.
//!
//! ## ABI surface note (ethexe / Solidity)
//!
//! On the `ethexe` Solidity path every exported parameter and return type must
//! implement `alloy_sol_types::SolValue`. Arbitrary SCALE structs/enums do not,
//! and there is no `#[derive(SolValue)]` for plain Rust types. To keep the rich
//! domain model intact while staying ABI-safe we:
//!   * pass enum discriminants as `u16` (`Collateral`, `Outcome`),
//!   * pass/return complex aggregates as SCALE-encoded `Vec<u8>` blobs
//!     (`Basket`, `Position`, `Settlement`, `Config`, the item list, ...).
//! The frontend (sails-js / SCALE) encodes inputs and decodes outputs with the
//! exact same type definitions, so no fidelity is lost. `Vec<u8>` and `String`
//! are confirmed-working on the current ethexe Solidity generation path.

use sails_rs::{cell::RefCell, prelude::*};

// ---------------------------------------------------------------------------
// Limits / constants
// ---------------------------------------------------------------------------

const MAX_ITEMS_PER_BASKET: usize = 32;
const MAX_NAME_LEN: usize = 128;
const MAX_DESCRIPTION_LEN: usize = 512;
const MAX_MARKET_ID_LEN: usize = 128;
const MAX_SLUG_LEN: usize = 128;
const BPS_DENOMINATOR: u32 = 10_000;

// Collateral discriminants used across the ABI boundary.
const COLLATERAL_ETH: u16 = 0;
const COLLATERAL_WVARA: u16 = 1;

// ---------------------------------------------------------------------------
// Domain types (rich SCALE types — used internally and SCALE-blobbed at the ABI edge)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
pub enum Collateral {
    Eth,
    Wvara,
}

impl Collateral {
    fn from_u16(v: u16) -> Result<Self, Error> {
        match v {
            COLLATERAL_ETH => Ok(Collateral::Eth),
            COLLATERAL_WVARA => Ok(Collateral::Wvara),
            _ => Err(Error::UnsupportedCollateral),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
pub enum Outcome {
    Yes,
    No,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
pub enum BasketStatus {
    Active,
    SettlementPending,
    Settled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
pub enum SettlementStatus {
    Proposed,
    Finalized,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
pub struct BasketItem {
    pub poly_market_id: String,
    pub poly_slug: String,
    pub weight_bps: u16,
    pub selected_outcome: Outcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
pub struct Basket {
    pub id: u64,
    pub creator: ActorId,
    pub name: String,
    pub description: String,
    pub items: Vec<BasketItem>,
    pub created_at: u64,
    pub status: BasketStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
pub struct Position {
    pub basket_id: u64,
    pub user: ActorId,
    pub collateral: Collateral,
    pub shares: u128,
    pub index_at_creation_bps: u16,
    pub claimed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
pub struct Settlement {
    pub basket_id: u64,
    pub proposer: ActorId,
    pub item_resolutions: Vec<Outcome>,
    pub index_bps: u16,
    pub proposed_at: u64,
    pub challenge_deadline: u64,
    pub finalized_at: Option<u64>,
    pub status: SettlementStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
pub struct Config {
    pub owner: ActorId,
    pub settler_role: ActorId,
    pub liveness_seconds: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode, TypeInfo, ReflectHash)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
#[reflect_hash(crate = sails_rs)]
pub enum Error {
    Unauthorized,
    ZeroValue,
    InsufficientBalance,
    PoolInsufficient,
    BasketNotFound,
    BasketNotActive,
    NoItems,
    TooManyItems,
    InvalidWeights,
    DuplicateBasketItem,
    NameTooLong,
    DescriptionTooLong,
    SettlementNotFound,
    SettlementNotProposed,
    SettlementAlreadyExists,
    SettlementNotFinalized,
    ChallengeDeadlineNotPassed,
    InvalidIndexAtCreation,
    AlreadyClaimed,
    NothingToClaim,
    PositionNotFound,
    MathOverflow,
    WvaraTransferFailed,
    EthTransferFailed,
    UnsupportedCollateral,
    InvalidItemsPayload,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub struct BasketMarketState {
    baskets: Vec<Basket>,
    positions: Vec<Position>,
    settlements: collections::HashMap<u64, Settlement>,
    ledger: collections::HashMap<(ActorId, Collateral), u128>,
    pool: collections::HashMap<Collateral, u128>,
    /// wVARA withdrawals awaiting the relayer to release real tokens from the vault.
    /// (recipient, amount, processed)
    pending_wvara: Vec<(ActorId, u128, bool)>,
    next_basket_id: u64,
    config: Config,
}

impl BasketMarketState {
    fn new(owner: ActorId, settler_role: ActorId, liveness_seconds: u64) -> Self {
        Self {
            baskets: Vec::new(),
            positions: Vec::new(),
            settlements: collections::HashMap::new(),
            ledger: collections::HashMap::new(),
            pool: collections::HashMap::new(),
            pending_wvara: Vec::new(),
            next_basket_id: 0,
            config: Config {
                owner,
                settler_role,
                liveness_seconds,
            },
        }
    }

    fn basket(&self, id: u64) -> Result<&Basket, Error> {
        self.baskets
            .iter()
            .find(|b| b.id == id)
            .ok_or(Error::BasketNotFound)
    }

    fn basket_mut(&mut self, id: u64) -> Result<&mut Basket, Error> {
        self.baskets
            .iter_mut()
            .find(|b| b.id == id)
            .ok_or(Error::BasketNotFound)
    }

    fn balance_of(&self, user: ActorId, collateral: Collateral) -> u128 {
        self.ledger
            .get(&(user, collateral))
            .copied()
            .unwrap_or_default()
    }

    fn pool_of(&self, collateral: Collateral) -> u128 {
        self.pool.get(&collateral).copied().unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// Guards / validation helpers
// ---------------------------------------------------------------------------

fn ensure_owner(state: &BasketMarketState, caller: ActorId) -> Result<(), Error> {
    if state.config.owner != caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn ensure_settler(state: &BasketMarketState, caller: ActorId) -> Result<(), Error> {
    if state.config.settler_role != caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn validate_metadata(name: &str, description: &str) -> Result<(), Error> {
    if name.len() > MAX_NAME_LEN {
        return Err(Error::NameTooLong);
    }
    if description.len() > MAX_DESCRIPTION_LEN {
        return Err(Error::DescriptionTooLong);
    }
    Ok(())
}

fn validate_items(items: &[BasketItem]) -> Result<(), Error> {
    if items.is_empty() {
        return Err(Error::NoItems);
    }
    if items.len() > MAX_ITEMS_PER_BASKET {
        return Err(Error::TooManyItems);
    }

    let mut total_weight = 0u32;
    for (index, item) in items.iter().enumerate() {
        if item.weight_bps == 0 || item.weight_bps as u32 > BPS_DENOMINATOR {
            return Err(Error::InvalidWeights);
        }
        if item.poly_market_id.len() > MAX_MARKET_ID_LEN
            || item.poly_slug.len() > MAX_SLUG_LEN
        {
            return Err(Error::InvalidWeights);
        }
        if items.iter().skip(index + 1).any(|other| {
            other.poly_market_id == item.poly_market_id
                && other.selected_outcome == item.selected_outcome
        }) {
            return Err(Error::DuplicateBasketItem);
        }
        total_weight = total_weight
            .checked_add(item.weight_bps as u32)
            .ok_or(Error::MathOverflow)?;
    }

    if total_weight != BPS_DENOMINATOR {
        return Err(Error::InvalidWeights);
    }
    Ok(())
}

fn validate_index_at_creation(index_at_creation_bps: u16) -> Result<(), Error> {
    if !(1..=10_000).contains(&index_at_creation_bps) {
        return Err(Error::InvalidIndexAtCreation);
    }
    Ok(())
}

/// payout = shares * settlement_index_bps / index_at_creation_bps,
/// computed with checked mul/div. If `index_at_creation_bps == 0` we fall back
/// to `shares` (no scaling) to guard against division by zero.
fn compute_payout(
    shares: u128,
    settlement_index_bps: u16,
    index_at_creation_bps: u16,
) -> Result<u128, Error> {
    if index_at_creation_bps == 0 {
        return Ok(shares);
    }
    if settlement_index_bps == 0 {
        return Ok(0);
    }
    shares
        .checked_mul(settlement_index_bps as u128)
        .and_then(|v| v.checked_div(index_at_creation_bps as u128))
        .ok_or(Error::MathOverflow)
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
#[derive(Clone, Debug, PartialEq, Eq, Encode, TypeInfo, ReflectHash)]
#[codec(crate = sails_rs::scale_codec)]
#[type_info(crate = sails_rs::type_info)]
#[reflect_hash(crate = sails_rs)]
pub enum BasketMarketEvents {
    BasketCreated(u64, [u8; 32]),
    BetPlaced(u64, [u8; 32], u16, u128),
    Claimed(u64, [u8; 32], u128),
    Deposited([u8; 32], u16, u128),
    Withdrawn([u8; 32], u16, u128),
    PoolSeeded(u16, u128),
    PoolWithdrawn(u16, u128),
    SettlementProposed(u64, u16, u64),
    SettlementFinalized(u64, u64),
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub struct BasketMarketService<'a> {
    state: &'a RefCell<BasketMarketState>,
}

impl<'a> BasketMarketService<'a> {
    pub fn new(state: &'a RefCell<BasketMarketState>) -> Self {
        Self { state }
    }
}

#[service(events = BasketMarketEvents)]
impl BasketMarketService<'_> {
    // -------------------------------------------------------------------
    // Gameplay — zero ETH value (injected path)
    // -------------------------------------------------------------------

    /// Create an Active basket. No collateral is attached.
    ///
    /// `items` is a SCALE-encoded `Vec<BasketItem>` blob (ABI-safe `Vec<u8>`).
    #[export(unwrap_result)]
    pub fn create_basket(
        &mut self,
        name: String,
        description: String,
        items: Vec<u8>,
    ) -> Result<u64, Error> {
        let mut items_slice: &[u8] = &items;
        let items: Vec<BasketItem> =
            Vec::<BasketItem>::decode(&mut items_slice).map_err(|_| Error::InvalidItemsPayload)?;

        validate_metadata(&name, &description)?;
        validate_items(&items)?;

        let creator = Syscall::message_source();
        let created_at = Syscall::block_timestamp();

        let mut state = self.state.borrow_mut();
        let basket_id = state.next_basket_id;
        state.next_basket_id = basket_id.checked_add(1).ok_or(Error::MathOverflow)?;

        state.baskets.push(Basket {
            id: basket_id,
            creator,
            name,
            description,
            items,
            created_at,
            status: BasketStatus::Active,
        });

        self.emit_event(BasketMarketEvents::BasketCreated(
            basket_id,
            creator.into_bytes(),
        ))
        .expect("failed to emit BasketCreated event");

        Ok(basket_id)
    }

    /// Place a bet by spending the caller's free ledger balance. No value
    /// attached. `shares == amount`. The staked amount is debited here; net
    /// pool accounting happens at claim time.
    ///
    /// `collateral` is `0 = Eth`, `1 = Wvara`.
    #[export(unwrap_result)]
    pub fn bet_on_basket(
        &mut self,
        basket_id: u64,
        collateral: u16,
        amount: u128,
        index_at_creation_bps: u16,
    ) -> Result<u128, Error> {
        let collateral = Collateral::from_u16(collateral)?;
        if amount == 0 {
            return Err(Error::ZeroValue);
        }
        validate_index_at_creation(index_at_creation_bps)?;

        let user = Syscall::message_source();
        let mut state = self.state.borrow_mut();

        {
            let basket = state.basket(basket_id)?;
            if basket.status != BasketStatus::Active {
                return Err(Error::BasketNotActive);
            }
        }

        let bal = state.balance_of(user, collateral);
        if bal < amount {
            return Err(Error::InsufficientBalance);
        }
        state.ledger.insert((user, collateral), bal - amount);

        let shares = amount;
        state.positions.push(Position {
            basket_id,
            user,
            collateral,
            shares,
            index_at_creation_bps,
            claimed: false,
        });

        self.emit_event(BasketMarketEvents::BetPlaced(
            basket_id,
            user.into_bytes(),
            collateral_to_u16(collateral),
            shares,
        ))
        .expect("failed to emit BetPlaced event");

        Ok(shares)
    }

    /// Claim a settled position. Credits the user's ledger with the payout and
    /// reconciles the house pool: net winnings come OUT of the pool, net losses
    /// flow INTO the pool. No value attached (credit is to the internal ledger).
    #[export(unwrap_result)]
    pub fn claim(&mut self, basket_id: u64) -> Result<u128, Error> {
        let user = Syscall::message_source();
        let mut state = self.state.borrow_mut();

        // Settlement must be finalized.
        let settlement_index_bps = {
            let settlement = state
                .settlements
                .get(&basket_id)
                .ok_or(Error::SettlementNotFinalized)?;
            if settlement.status != SettlementStatus::Finalized {
                return Err(Error::SettlementNotFinalized);
            }
            settlement.index_bps
        };

        // Find the caller's (first) position for this basket.
        let pos_idx = state
            .positions
            .iter()
            .position(|p| p.basket_id == basket_id && p.user == user)
            .ok_or(Error::NothingToClaim)?;

        if state.positions[pos_idx].claimed {
            return Err(Error::AlreadyClaimed);
        }

        let shares = state.positions[pos_idx].shares;
        let index_at_creation_bps = state.positions[pos_idx].index_at_creation_bps;
        let collateral = state.positions[pos_idx].collateral;

        let payout = compute_payout(shares, settlement_index_bps, index_at_creation_bps)?;

        // Pool reconciliation. The staked `shares` were already debited at bet
        // time, so the pool only needs to cover the *net* delta.
        if payout > shares {
            let net_win = payout - shares;
            let pool_bal = state.pool_of(collateral);
            if pool_bal < net_win {
                return Err(Error::PoolInsufficient);
            }
            state.pool.insert(collateral, pool_bal - net_win);
        } else if payout < shares {
            // Losing remainder (including total loss, payout == 0) flows to pool.
            let net_loss = shares - payout;
            let pool_bal = state.pool_of(collateral);
            let new_pool = pool_bal.checked_add(net_loss).ok_or(Error::MathOverflow)?;
            state.pool.insert(collateral, new_pool);
        }

        // Credit payout to the user's free ledger balance.
        if payout > 0 {
            let bal = state.balance_of(user, collateral);
            let new_bal = bal.checked_add(payout).ok_or(Error::MathOverflow)?;
            state.ledger.insert((user, collateral), new_bal);
        }

        state.positions[pos_idx].claimed = true;

        self.emit_event(BasketMarketEvents::Claimed(
            basket_id,
            user.into_bytes(),
            payout,
        ))
        .expect("failed to emit Claimed event");

        Ok(payout)
    }

    // -------------------------------------------------------------------
    // Value movement — classic value-carrying messages
    // -------------------------------------------------------------------

    /// Deposit native ETH; the attached message value is credited to the
    /// caller's Eth ledger balance.
    #[export(payable, unwrap_result)]
    pub fn deposit_eth(&mut self) -> Result<u128, Error> {
        let user = Syscall::message_source();
        let amount = Syscall::message_value();
        if amount == 0 {
            return Err(Error::ZeroValue);
        }

        let mut state = self.state.borrow_mut();
        let bal = state.balance_of(user, Collateral::Eth);
        let new_bal = bal.checked_add(amount).ok_or(Error::MathOverflow)?;
        state.ledger.insert((user, Collateral::Eth), new_bal);

        self.emit_event(BasketMarketEvents::Deposited(
            user.into_bytes(),
            COLLATERAL_ETH,
            amount,
        ))
        .expect("failed to emit Deposited event");

        Ok(new_bal)
    }

    /// Credit a user's wVARA ledger balance. **Owner/relayer only.**
    ///
    /// Real wVARA is custodied by the `WvaraVault` Solidity contract on Ethereum.
    /// Flow: user calls `vault.deposit(amount)` (real ERC-20 transferFrom) → the vault
    /// emits `Deposited(user, amount)` → the relayer (the owner key) calls this to mirror
    /// the real, backed deposit into the betting ledger. The on-chain wVARA never lives in
    /// this program — only its accounting does — so balances are always backed 1:1 by the vault.
    #[export(unwrap_result)]
    pub fn credit_wvara(&mut self, user: ActorId, amount: u128) -> Result<u128, Error> {
        if amount == 0 {
            return Err(Error::ZeroValue);
        }
        let caller = Syscall::message_source();

        let mut state = self.state.borrow_mut();
        ensure_owner(&state, caller)?;

        let bal = state.balance_of(user, Collateral::Wvara);
        let new_bal = bal.checked_add(amount).ok_or(Error::MathOverflow)?;
        state.ledger.insert((user, Collateral::Wvara), new_bal);

        self.emit_event(BasketMarketEvents::Deposited(
            user.into_bytes(),
            COLLATERAL_WVARA,
            amount,
        ))
        .expect("failed to emit Deposited event");

        Ok(new_bal)
    }

    /// Withdraw native ETH: debit the ledger and return the value to the caller
    /// via the reply (the ethexe value-egress primitive).
    #[export(unwrap_result)]
    pub fn withdraw_eth(&mut self, amount: u128) -> Result<CommandReply<()>, Error> {
        if amount == 0 {
            return Err(Error::ZeroValue);
        }
        let user = Syscall::message_source();

        let mut state = self.state.borrow_mut();
        let bal = state.balance_of(user, Collateral::Eth);
        if bal < amount {
            return Err(Error::InsufficientBalance);
        }
        state.ledger.insert((user, Collateral::Eth), bal - amount);

        self.emit_event(BasketMarketEvents::Withdrawn(
            user.into_bytes(),
            COLLATERAL_ETH,
            amount,
        ))
        .expect("failed to emit Withdrawn event");

        // ETH egress: value is attached to the reply sent back to the caller.
        // TODO(verify): ETH egress primitive. `CommandReply::with_value` is the
        // value-returning pattern proven by the vault example's `withdraw`. If a
        // different ethexe egress primitive is required to pay an arbitrary
        // recipient (vs. the message source), revisit here.
        Ok(CommandReply::new(()).with_value(amount))
    }

    /// Withdraw wVARA: debit the ledger and queue a release for the relayer.
    ///
    /// The real tokens live in the `WvaraVault`, so we can't pay the user from inside the
    /// program. Instead we debit the ledger and enqueue `(user, amount)`; the relayer polls
    /// `GetPendingWvaraWithdrawals`, calls `vault.release(user, amount)` (real ERC-20 transfer),
    /// then marks the entry processed. Returns the queue index of the pending withdrawal.
    #[export(unwrap_result)]
    pub fn withdraw_wvara(&mut self, amount: u128) -> Result<u32, Error> {
        if amount == 0 {
            return Err(Error::ZeroValue);
        }
        let user = Syscall::message_source();

        let mut state = self.state.borrow_mut();
        let bal = state.balance_of(user, Collateral::Wvara);
        if bal < amount {
            return Err(Error::InsufficientBalance);
        }
        state.ledger.insert((user, Collateral::Wvara), bal - amount);

        let index = state.pending_wvara.len() as u32;
        state.pending_wvara.push((user, amount, false));

        self.emit_event(BasketMarketEvents::Withdrawn(
            user.into_bytes(),
            COLLATERAL_WVARA,
            amount,
        ))
        .expect("failed to emit Withdrawn event");

        Ok(index)
    }

    /// Mark a queued wVARA withdrawal as released. **Owner/relayer only** — called after the
    /// relayer has transferred the real wVARA from the vault to the recipient.
    #[export(unwrap_result)]
    pub fn mark_wvara_processed(&mut self, index: u32) -> Result<(), Error> {
        let caller = Syscall::message_source();
        let mut state = self.state.borrow_mut();
        ensure_owner(&state, caller)?;
        let entry = state
            .pending_wvara
            .get_mut(index as usize)
            .ok_or(Error::PositionNotFound)?;
        entry.2 = true;
        Ok(())
    }

    // -------------------------------------------------------------------
    // House pool — operator only
    // -------------------------------------------------------------------

    /// Seed the ETH house pool with the attached message value (operator only).
    /// Returns the new pool balance.
    #[export(payable, unwrap_result)]
    pub fn seed_pool_eth(&mut self) -> Result<u128, Error> {
        let caller = Syscall::message_source();
        let amount = Syscall::message_value();
        if amount == 0 {
            return Err(Error::ZeroValue);
        }

        let mut state = self.state.borrow_mut();
        ensure_owner(&state, caller)?;

        let pool_bal = state.pool_of(Collateral::Eth);
        let new_pool = pool_bal.checked_add(amount).ok_or(Error::MathOverflow)?;
        state.pool.insert(Collateral::Eth, new_pool);

        self.emit_event(BasketMarketEvents::PoolSeeded(COLLATERAL_ETH, amount))
            .expect("failed to emit PoolSeeded event");

        Ok(new_pool)
    }

    /// Seed the wVARA house pool by `amount` (operator only).
    ///
    // TODO(verify): wVARA pull mechanism (same as deposit_wvara). The operator
    // must have made the wVARA available to the program; this method records the
    // pool increase. Pin the actual pull in the wVARA spike.
    #[export(unwrap_result)]
    pub fn seed_pool_wvara(&mut self, amount: u128) -> Result<u128, Error> {
        if amount == 0 {
            return Err(Error::ZeroValue);
        }
        let caller = Syscall::message_source();

        let mut state = self.state.borrow_mut();
        ensure_owner(&state, caller)?;

        let pool_bal = state.pool_of(Collateral::Wvara);
        let new_pool = pool_bal.checked_add(amount).ok_or(Error::MathOverflow)?;
        state.pool.insert(Collateral::Wvara, new_pool);

        self.emit_event(BasketMarketEvents::PoolSeeded(COLLATERAL_WVARA, amount))
            .expect("failed to emit PoolSeeded event");

        Ok(new_pool)
    }

    /// Withdraw ETH from the house pool back to the operator (operator only).
    #[export(unwrap_result)]
    pub fn withdraw_pool_eth(&mut self, amount: u128) -> Result<CommandReply<()>, Error> {
        if amount == 0 {
            return Err(Error::ZeroValue);
        }
        let caller = Syscall::message_source();

        let mut state = self.state.borrow_mut();
        ensure_owner(&state, caller)?;

        let pool_bal = state.pool_of(Collateral::Eth);
        if pool_bal < amount {
            return Err(Error::PoolInsufficient);
        }
        state.pool.insert(Collateral::Eth, pool_bal - amount);

        self.emit_event(BasketMarketEvents::PoolWithdrawn(COLLATERAL_ETH, amount))
            .expect("failed to emit PoolWithdrawn event");

        // TODO(verify): ETH egress primitive (see withdraw_eth).
        Ok(CommandReply::new(()).with_value(amount))
    }

    /// Withdraw wVARA from the house pool back to the operator (operator only).
    /// Debits the pool and queues a vault release for the relayer (returns queue index).
    #[export(unwrap_result)]
    pub fn withdraw_pool_wvara(&mut self, amount: u128) -> Result<u32, Error> {
        if amount == 0 {
            return Err(Error::ZeroValue);
        }
        let caller = Syscall::message_source();

        let mut state = self.state.borrow_mut();
        ensure_owner(&state, caller)?;

        let pool_bal = state.pool_of(Collateral::Wvara);
        if pool_bal < amount {
            return Err(Error::PoolInsufficient);
        }
        state.pool.insert(Collateral::Wvara, pool_bal - amount);

        let index = state.pending_wvara.len() as u32;
        state.pending_wvara.push((caller, amount, false));

        self.emit_event(BasketMarketEvents::PoolWithdrawn(COLLATERAL_WVARA, amount))
            .expect("failed to emit PoolWithdrawn event");

        Ok(index)
    }

    // -------------------------------------------------------------------
    // Settlement — settler role
    // -------------------------------------------------------------------

    /// Propose a settlement (settler role). Opens the challenge window.
    ///
    /// `item_resolutions` is a SCALE-encoded `Vec<Outcome>` blob (ABI-safe
    /// `Vec<u8>`).
    #[export(unwrap_result)]
    pub fn propose_settlement(
        &mut self,
        basket_id: u64,
        item_resolutions: Vec<u8>,
        index_bps: u16,
    ) -> Result<(), Error> {
        let mut res_slice: &[u8] = &item_resolutions;
        let item_resolutions: Vec<Outcome> = Vec::<Outcome>::decode(&mut res_slice)
            .map_err(|_| Error::InvalidItemsPayload)?;

        let caller = Syscall::message_source();
        let now = Syscall::block_timestamp();

        let mut state = self.state.borrow_mut();
        ensure_settler(&state, caller)?;

        {
            let basket = state.basket(basket_id)?;
            if basket.status != BasketStatus::Active {
                return Err(Error::BasketNotActive);
            }
        }
        if state.settlements.contains_key(&basket_id) {
            return Err(Error::SettlementAlreadyExists);
        }

        let liveness_ms = state
            .config
            .liveness_seconds
            .checked_mul(1_000)
            .ok_or(Error::MathOverflow)?;
        let challenge_deadline = now.checked_add(liveness_ms).ok_or(Error::MathOverflow)?;

        state.settlements.insert(
            basket_id,
            Settlement {
                basket_id,
                proposer: caller,
                item_resolutions,
                index_bps,
                proposed_at: now,
                challenge_deadline,
                finalized_at: None,
                status: SettlementStatus::Proposed,
            },
        );
        state.basket_mut(basket_id)?.status = BasketStatus::SettlementPending;

        self.emit_event(BasketMarketEvents::SettlementProposed(
            basket_id,
            index_bps,
            challenge_deadline,
        ))
        .expect("failed to emit SettlementProposed event");

        Ok(())
    }

    /// Finalize a proposed settlement once the challenge window has passed.
    #[export(unwrap_result)]
    pub fn finalize_settlement(&mut self, basket_id: u64) -> Result<(), Error> {
        let now = Syscall::block_timestamp();
        let mut state = self.state.borrow_mut();

        {
            let settlement = state
                .settlements
                .get_mut(&basket_id)
                .ok_or(Error::SettlementNotFound)?;
            if settlement.status != SettlementStatus::Proposed {
                return Err(Error::SettlementNotProposed);
            }
            if now < settlement.challenge_deadline {
                return Err(Error::ChallengeDeadlineNotPassed);
            }
            settlement.status = SettlementStatus::Finalized;
            settlement.finalized_at = Some(now);
        }

        state.basket_mut(basket_id)?.status = BasketStatus::Settled;

        self.emit_event(BasketMarketEvents::SettlementFinalized(basket_id, now))
            .expect("failed to emit SettlementFinalized event");

        Ok(())
    }

    // -------------------------------------------------------------------
    // Queries — free reads (SCALE-blob returns are ABI-safe Vec<u8>)
    // -------------------------------------------------------------------

    /// Returns a SCALE-encoded `Basket`. Errors via `unwrap_result` if missing.
    #[export(unwrap_result)]
    pub fn get_basket(&self, id: u64) -> Result<Vec<u8>, Error> {
        Ok(self.state.borrow().basket(id)?.encode())
    }

    #[export]
    pub fn get_basket_count(&self) -> u64 {
        self.state.borrow().baskets.len() as u64
    }

    /// Returns a SCALE-encoded `Vec<Position>` for `user`.
    #[export]
    pub fn get_positions(&self, user: ActorId) -> Vec<u8> {
        let positions: Vec<Position> = self
            .state
            .borrow()
            .positions
            .iter()
            .filter(|p| p.user == user)
            .cloned()
            .collect();
        positions.encode()
    }

    /// Returns a SCALE-encoded `Option<Settlement>` for `basket_id`.
    #[export]
    pub fn get_settlement(&self, basket_id: u64) -> Vec<u8> {
        let settlement: Option<Settlement> =
            self.state.borrow().settlements.get(&basket_id).cloned();
        settlement.encode()
    }

    /// Free balance for `user` in `collateral` (`0 = Eth`, `1 = Wvara`).
    #[export(unwrap_result)]
    pub fn get_balance(&self, user: ActorId, collateral: u16) -> Result<u128, Error> {
        let collateral = Collateral::from_u16(collateral)?;
        Ok(self.state.borrow().balance_of(user, collateral))
    }

    /// Returns a SCALE-encoded `Vec<(Collateral, u128)>` of all free balances.
    #[export]
    pub fn get_balances(&self, user: ActorId) -> Vec<u8> {
        let state = self.state.borrow();
        let balances: Vec<(Collateral, u128)> = vec![
            (Collateral::Eth, state.balance_of(user, Collateral::Eth)),
            (Collateral::Wvara, state.balance_of(user, Collateral::Wvara)),
        ];
        balances.encode()
    }

    /// House pool balance for `collateral` (`0 = Eth`, `1 = Wvara`).
    #[export(unwrap_result)]
    pub fn get_pool(&self, collateral: u16) -> Result<u128, Error> {
        let collateral = Collateral::from_u16(collateral)?;
        Ok(self.state.borrow().pool_of(collateral))
    }

    /// Returns a SCALE-encoded `Config`.
    #[export]
    pub fn get_config(&self) -> Vec<u8> {
        self.state.borrow().config.clone().encode()
    }

    /// Unprocessed wVARA withdrawals for the relayer to release from the vault.
    /// Returns a SCALE-encoded `Vec<(u32 index, ActorId user, u128 amount)>`.
    #[export]
    pub fn get_pending_wvara_withdrawals(&self) -> Vec<u8> {
        let state = self.state.borrow();
        let pending: Vec<(u32, ActorId, u128)> = state
            .pending_wvara
            .iter()
            .enumerate()
            .filter(|(_, (_, _, processed))| !*processed)
            .map(|(i, (user, amount, _))| (i as u32, *user, *amount))
            .collect();
        pending.encode()
    }
}

fn collateral_to_u16(collateral: Collateral) -> u16 {
    match collateral {
        Collateral::Eth => COLLATERAL_ETH,
        Collateral::Wvara => COLLATERAL_WVARA,
    }
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

pub struct Program {
    state: RefCell<BasketMarketState>,
}

#[program]
impl Program {
    /// Constructor. `owner` is set to the message source (the deployer/operator).
    /// Named `init` because `new` is a reserved word on the Solidity ABI path.
    pub fn init(settler_role: ActorId, liveness_seconds: u64) -> Self {
        let owner = Syscall::message_source();
        Self {
            state: RefCell::new(BasketMarketState::new(owner, settler_role, liveness_seconds)),
        }
    }

    pub fn basket_market(&self) -> BasketMarketService<'_> {
        BasketMarketService::new(&self.state)
    }
}
