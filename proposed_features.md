# Proposed Features — Banking Sim Realism Enhancements

This document catalogs improvements not yet implemented, organized by priority.

---

## Phase 3 — Expected Credit Loss Provisions (IFRS 9 / CECL)

**Problem:** Losses are recognized only at default (incurred loss model). Modern accounting requires booking expected losses on origination.

### Implementation

| File | Change |
|---|---|
| `js/ledger.js` `ACCOUNT_TYPES` | Add `allowanceForCreditLosses` (contra-asset, credit-normal) and `provisionExpense` (expense) |
| `js/ledger.js` `getEquity` | Subtract allowance from assets: `equity = (cash + loansReceivable - allowance) - (deposits + cbBorrowing)` |
| `js/mechanics.js` | Add `provisionForLoan(s)` on month boundaries. For each active loan: `provisionTarget = remainingBalance × defaultProb × LGD`. Sum targets, adjust allowance to match, flow difference through `provisionExpense`. |
| `js/mechanics.js` `processDefaults` | Debit `allowanceForCreditLosses` first on default, only hit `defaultLosses` if allowance is insufficient |
| `js/ui.js` | Show allowance balance on balance sheet, provision expense in P&L |

### Complexity
Medium-High (~150 lines). Teaches why bank profits are lower than they first appear — expected losses are booked upfront.

---

## Phase 4 — Tiered Capital (CET1, AT1, Tier 2) + Retained Earnings + Dividends

**Problem:** A single equity account. No retained earnings closure, no tiered capital, no dividends.

### Implementation

| File | Change |
|---|---|
| `js/ledger.js` `ACCOUNT_TYPES` | Split equity into `shareCapital` (equity) + `retainedEarnings` (equity). Add `atiCapital` (AT1, equity) and `tier2Capital` (sub-debt, liability) |
| `js/ledger.js` | Add `closeYearEnd(s)` — called every 720 ticks, zeroes income/expense accounts to `retainedEarnings` |
| `js/mechanics.js` `updatePenalty` | Triple capital check: CET1/RWA ≥ 4.5%, Tier1/RWA ≥ 6%, TotalCapital/RWA ≥ 8% |
| `js/mechanics.js` | Add `payDividend(s, amount)` — debits `retainedEarnings`, credits `cash`. Restricted if CET1 < 4.5% + buffer |
| `js/ui.js` | Show CET1, Tier1, Total Capital ratios in compliance. Add dividend payout button in Policies tab |
| `js/actions.js` | Wire dividend action |

### Complexity
Medium (~120 lines). The retained earnings closure is needed for proper accounting — income accounts reset yearly.

---

## Phase 5 — Liquidity Coverage Ratio (LCR)

**Problem:** The liquidity check is `cash/deposits ≥ 5%` — no HQLA concept, no cash-flow modeling.

### Implementation

| File | Change |
|---|---|
| `js/mechanics.js` | Add `computeLcr(s)`. HQLA = cash. Net outflows = deposits × outflowPct (regime-dependent: boom 3%, normal 5%, recession 15%, bank run 50%). LCR = HQLA / outflows. Threshold ≥ 1.0 (100%) |
| `js/mechanics.js` `updatePenalty` | Replace old liquidity check (`RR < 5`) with LCR-based penalty, same severity weight (5) |
| `js/ui.js` | Show LCR% in compliance display |
| `js/constants.js` | Add `LCR_OUTFLOW_PCT` per regime, `LCR_THRESHOLD = 1.0` |

### Complexity
Medium (~50 lines). Replaces the arbitrary 5% rule with something closer to Basel III.

---

## Phase 6 — Interbank Lending Market

**Problem:** Only one source of external funding (central bank). No interbank market or wholesale funding.

### Implementation

- Add `interbankBorrowing` and `interbankLending` accounts
- Market rate = MRO + random spread (e.g., 10–50bp) driven by overall market conditions
- Counterparty limit based on equity (can't borrow more than, say, 3× equity)
- Provides an alternative to the CB corridor — can lend excess reserves or borrow cheaply in normal times

### Complexity
Medium (~80 lines). Adds strategic depth to liquidity management.

---

## Phase 7 — Corporate Income Tax

**Problem:** No taxation. This makes the interest-expense tax shield invisible.

### Implementation

- Apply corporate tax rate (e.g., 25%) to net income on yearly or quarterly basis
- Debit `taxExpense`, credit `taxPayable` (liability)
- Pay tax monthly/quarterly from cash
- Deferred tax for timing differences (future enhancement)

### Complexity
Low (~40 lines). Simple but improves P&L realism.

---

## Phase 8 — Large Exposure / Concentration Limits

**Problem:** A single loan can be up to 90% of assets with no regulatory limit.

### Implementation

- Add a compliance check: largest single exposure / total capital ≤ 25% (Basel standard)
- Penalty for exceeding the limit
- UI warning when a pending loan would breach the limit

### Complexity
Low (~30 lines). Prevents degenerate strategies of originating one giant loan.

---

## Phase 9 — Operational Risk Events

**Problem:** Only loan officer capacity models operational constraints. No fraud, system failures, or compliance costs.

### Implementation

- Low-probability random events: "operational loss" (e.g., fraud, IT failure)
- Amount proportional to total assets or transaction volume
- New expense account `operationalLoss`
- Could be tied to bank size/complexity

### Complexity
Low (~30 lines). Adds unpredictability beyond credit risk.

---

## Phase 10 — Securities Portfolio / Investment Book

**Problem:** Only loans and cash. No government bonds, no securities.

### Implementation

- Add `securities` (asset account) — government bonds with fixed yield
- Player can buy/sell securities via a new UI panel
- Securities count as HQLA for LCR
- Interest income from securities

### Complexity
Medium-High (~150 lines). Adds asset-liability management depth.

---

---

## Phase 11 — AI Competitor Banks

**Problem:** You run a single bank in isolation. No competitive pressure, no market dynamics.

### Implementation

- 2-3 simple simulated competitor banks that adjust deposit/loan rates dynamically
- Their rates influence your deposit flight risk and loan demand — you're no longer the only game in town
- Each competitor has a simple AI: targets a spread over MRO, adjusts rates based on market share
- Display competitor rates in the Policies tab for comparison

### Complexity
High (~200 lines). Adds strategic depth but requires careful balancing.

---

## Phase 12 — Securitization / Loan Sales

**Problem:** No way to remove loans from the balance sheet once originated.

### Implementation

- A "Sell Loans" button in the Loans tab that packages selected loans and sells them at a discount
- Removes loans from the balance sheet, frees up capital, generates fee income
- Recourse vs non-recourse options
- Pricing based on portfolio quality and market conditions

### Complexity
Medium (~120 lines). Adds asset-liability management flexibility.

---

## Phase 13 — Stress Testing Tool (Unlockable via Research)

**Problem:** Players have no way to see how their portfolio would behave under adverse conditions.

### Implementation

- A "Run Scenario" button in the Research tab, unlockable at Research Level 3 (cost: 15 RP)
- Applies a temporary regime + default multiplier to your current portfolio
- Shows projected capital adequacy, NPL ratio, and P&L impact without actually changing state
- Three scenarios: Mild recession, Severe recession, Bank run
- Stored results visible in a new "Stress Tests" card

### Complexity
Low-Medium (~80 lines). Gives players a risk management tool and makes research points feel more valuable.

---

## Summary by Priority

| Priority | Feature | Complexity | Why |
|---|---|---|---|---|
| High | Expected credit loss provisions | Medium-High | Major accounting realism gap |
| High | Tiered capital + retained earnings | Medium | Basel concept, accounting fix |
| High | LCR | Medium | Replaces arbitrary liquidity rule |
| Medium | Interbank market | Medium | Funding diversification |
| Medium | Corporate tax | Low | Simple, visible impact on P&L |
| Medium | Large exposure limits | Low | Prevents degenerate strategies |
| Medium | Stress testing tool (research-locked) | Low-Medium | Risk management + RP sink |
| Medium | Securitization / loan sales | Medium | ALM flexibility |
| Low | AI competitor banks | High | Competitive depth, needs balancing |
| Low | Operational risk events | Low | Adds variety |
| Low | Securities portfolio | Medium-High | LCR + ALM depth |
