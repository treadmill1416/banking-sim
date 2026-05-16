# Bank Runner

A browser-based banking simulation where you run a commercial bank. Set interest rates, approve loans, manage reserves, and navigate the ECB's policy corridor. Built with vanilla JS — no frameworks, no dependencies.

## Play

```
python3 -m http.server
```

Open `http://localhost:8000` in a browser. Game starts paused — hit **▶** to begin.

## Concept

You are a commercial bank. Customers deposit money, customers request loans. You set rates, approve credit, and keep reserves above the 1% requirement.

The core mechanic is **realistic credit creation**: when you approve a loan, the deposit is created out of thin air (book money). Reserves are the binding constraint, not deposits. Approve too many loans and you'll need to borrow from the central bank at a penalty rate.

Full sandbox — no win/loss conditions. Keep playing even if equity goes negative.

## Controls

| Control | What it does |
|---|---|
| **Loan rate slider** | Higher rate = more income, less demand |
| **Deposit rate slider** | Higher rate = more deposits, higher cost |
| **Approve / Reject** | Decide on loan requests in the Loan Applications panel |
| **Auto-accept threshold** | Auto-approve loans below a default risk % |
| **CB Desk** | Manually borrow or repay central bank loans |
| **Auto-borrow toggle** (Config) | Let the CB auto-lend when reserves fall short |
| **Pause / Play** | Stop or resume time |
| **Speed (1× / 3× / 10×)** | 1 tick = 1 hour of game time |

## Balance Sheet

| Assets | Liabilities |
|---|---|
| Reserves (at central bank) | Demand deposits |
| Loans to customers | Central bank borrowing |
| | Equity (capital) |

Starting position: $10M deposits, $8M loans, $100K equity, $100K reserves (1%). Tight start — any new loan immediately strains reserves.

## ECB Corridor

Three policy rates that drift ±25bp in response to simulated economic conditions:

- **Deposit facility** (floor) — what excess reserves earn
- **MRO** (mid) — main refinancing rate, policy signal
- **Marginal lending facility** (ceiling) — penalty rate for borrowing

Interest accrues every tick on deposits, reserves, and CB borrowing at their respective rates. Loan interest is handled via monthly amortizing payments.

## Random Events

Each tick (~1 hour) events can fire:
- **Deposit flows** ±$50K–$500K, influenced by your rate vs market
- **Loan requests** sized by power law (peak at 3% of balance sheet), with a default probability estimate
- **Loan defaults** ~3–5% annualized, varies by economic regime
- **ECB rate changes** ~2% chance per tick
- **Regime shifts** between boom / normal / recession — affects loan demand, default risk, deposit flows, and ECB bias

## Mathematics

All values in dollars unless noted. One tick = one game-hour.

### Balance Sheet

```
equity        = reserves + loans − deposits − cbBorrowing
totalAssets   = reserves + loans
requiredReserves = deposits × RESERVE_RATIO_TARGET        (1%)
reserveRatio  = reserves / deposits × 100
```

### Net Interest Margin (annualized)

```
earningAssets = loans + reserves

annualLoanIncome    = loans × weightedLoanRate / 100
annualDepositCost   = deposits × depositRate / 100
annualReserveIncome = reserves × ecbDepositRate / 100
annualCbCost        = cbBorrowing × ecbMlfRate / 100

NIM = (annualLoanIncome + annualReserveIncome − annualDepositCost − annualCbCost) / earningAssets × 100
```

### Per-Tick Interest Accrual

Every tick, net interest on deposits, reserves, and CB borrowing is accumulated. Loan interest is handled separately via monthly amortizing payments (see below).

```
hourly = 1 / 8760   (TICKS_PER_YEAR)

Δreserves = reserves × (ecbDepositRate / 100) × hourly
          − deposits × (depositRate / 100) × hourly
          − cbBorrowing × (ecbMlfRate / 100) × hourly
```

Accumulated interest is posted to the ledger every 24 ticks via `postDailyInterest`.

### P&L Tracking

Running totals accumulate per tick (deposit, reserve, CB interest) and are posted to the ledger every 24 ticks. Loan interest is booked via monthly amortizing payments. P&L resets every `TICKS_PER_MONTH` (730 ticks):

```
pnl.net = reserveInterestIncome − depositInterest − cbInterest − defaults + loanInterestIncome
```

The current month's P&L is computed as the delta between current income/expense account balances and the snapshot taken at the start of the month.

### Weighted Average Loan Rate

On approval:

```
weightedLoanRate = (oldLoans × oldWeightedRate + newAmount × newRate) / newTotalLoans
```

Recomputed from all active loans:

```
weightedLoanRate = Σ(amount_i × rate_i) / Σ(amount_i)
```

### Credit Creation (Money Multiplier)

When a loan is approved, the deposit is created **ex nihilo**:

```
loans    += loanAmount
deposits += loanAmount
```

### Loan Defaults

Each active loan faces default risk every tick:

```
annualProb = (loan.defaultProb / 100) × REGIME_MULTIPLIERS[regime]
tickProb   = annualProb / 8760
```

Default occurs if `random() < tickProb`. Regime multipliers:

| Regime    | Multiplier |
|-----------|-----------|
| boom      | 0.5       |
| normal    | 1.0       |
| recession | 2.5       |

### Non-Performing Loan Ratio (trailing)

```
NPL = Σ(default amounts in last 720 ticks) / loans × 100
```

### Rolling Annual Default Rate

```
cutoff = currentTick − 8760
defaultRate = (defaulted loans since cutoff) / (finished loans since cutoff) × 100
```

### Customer Refusal Probability

When the bank sets a loan rate, customers may refuse:

```
spread    = max(0, offeredRate − ecbMroRate)
refusalProb = clamp(spread × REGIME_MULTIPLIERS[regime] × 8, min=5, max=95)
```

Refusal if `random() < refusalProb / 100`.

### Deposit Stability (Flight Risk)

When `depositRate − ecbMroRate < depositStabilityThreshold`:

```
severity = |spread − depositStabilityThreshold|
prob     = min(0.1, 0.002 × severity × REGIME_MULTIPLIERS[regime])
pct      = min(0.01, 0.0005 × severity × REGIME_MULTIPLIERS[regime])
outflow  = deposits × pct × (0.5 + random())   (min $1,000)
reserves −= outflow; deposits −= outflow
```

### Deposit Flow Events

Rate-driven inflows/outflows. Per-tick probability: 12%.

```
base     = 50000 + random() × 450000
modifier = (depositRate − ecbMroRate) × 200000
amount   = (base + modifier) × REGIME_DEPOSIT_MOD[regime]
```

If amount > 0 (inflow): reserves += amount × (0.5 + random × 0.5); deposits += same.
If amount < 0 (outflow): outflow capped at 2% of deposits.

| Regime    | Deposit Mod |
|-----------|------------|
| boom      | 1.5        |
| normal    | 1.0        |
| recession | 0.4        |

### Loan Request Generation

Per-tick probability: controlled by `loanRequestsPerMonth / TICKS_PER_MONTH`.

```
modeTarget    = totalAssets × (loanDemandPeakPct / 100)      (default 3%)
alpha         = 2
rawAmount     = modeTarget / random()^(1/alpha)               (Pareto power law)
amount        = min(rawAmount, totalAssets × 0.9)

defaultProb   = min((0.5 + random() × 12) × REGIME_DEFAULT_RISK[regime], 35)
duration      = 3 + floor(random() × 34) months
```

Most loan requests cluster around `loanDemandPeakPct`% of the balance sheet. The Pareto tail (α=2) produces occasional larger requests — some at 10× the mode, very rarely up to 90% of total assets.

Loan demand by regime:

| Regime    | Default Risk Mult |
|-----------|-------------------|
| boom      | 0.4               |
| normal    | 1.0               |
| recession | 2.5               |

### ECB Policy Rate Changes

Per-tick probability: 2%. Direction determined by regime bias:

| Regime    | Rate-Up Probability |
|-----------|-------------------|
| boom      | 0.6               |
| normal    | 0.5               |
| recession | 0.3               |

```
direction  = random() < bias ? +1 : −1
rateIndex  = floor(random() × 3)     // which of the 3 rates changes
newRate    = clamp(currentRate ± 0.25, min=0, max=10)

Constraints enforced:
  ecbDepositRate ≤ ecbMroRate − 0.25
  ecbMroRate     ≤ ecbMlfRate − 0.25
```

### Regime Changes (Markov Chain)

Per-tick probability: 0.3%. Transition matrix:

| From \ To | boom | normal | recession |
|-----------|------|--------|-----------|
| boom      | 0.1  | 0.8    | 0.1       |
| normal    | 0.05 | 0.9    | 0.05      |
| recession | 0.1  | 0.8    | 0.1       |

### Loan Payments (Amortizing)

Loans are amortized monthly with equal principal payments. Duration: 3–36 months at origination.

First payment is due immediately on the day of approval; subsequent payments fall on the 1st of each game‑month (`tick % TICKS_PER_MONTH === 0`).

```
monthlyRate  = rate / 100 / 12
interest     = remainingBalance × monthlyRate
principal    = min(loanAmount / durationMonths, remainingBalance)
total        = principal + interest

deposits         −= total     (Dr)
loansReceivable  −= principal (Cr)
interestIncome   += interest  (Cr)
```

After the final payment (`remainingBalance < 0.005`) the loan is marked `repaid`.

### Reserve Auto-Borrowing

```
if reserves < requiredReserves and autoCbBorrowing:
    deficit = requiredReserves − reserves
    cbBorrowing += deficit
    reserves   += deficit
```

Borrowed at the marginal lending facility rate (`ecbMlfRate`).

### Time System

```
1 tick           = 1 game-hour
TICKS_PER_YEAR   = 8760    (365 × 24)
TICKS_PER_MONTH  = 730     (8760 / 12)
TICKS_PER_QUARTER = 2190   (8760 / 4)

Date: new Date(2026, 0, 1) + tick × 3600000 ms
```

### Key Constants

| Constant | Value |
|----------|-------|
| `RESERVE_RATIO_TARGET` | 0.01 (1%) |
| `CB_SPREAD` | 0.25 (25 bp) |
| `RATE_MIN` / `RATE_MAX` | 0 / 10 |
| `LOAN_RATE_MIN` / `LOAN_RATE_MAX` | 0.5% / 20% |
| `DEPO_RATE_MIN` / `DEPO_RATE_MAX` | 0% / 10% |
| `LOAN_EXPIRY_TICKS` | 730 (1 month) |
| `NPL_WINDOW` | 720 (~1 month) |
| `DEPO_STABILITY_PROB` | 0.002 |
| `DEPO_STABILITY_RATE` | 0.0005 |
| `PROB.depositFlow` | 0.12 |
| `PROB.loanRequest` | 0.06 |
| `PROB.ecbChange` | 0.02 |
| `PROB.regimeChange` | 0.003 |

## Project Structure

```
├── index.html         # HTML skeleton
├── css/style.css      # All styles
└── js/
    ├── main.js        # Game loop, event delegation, init
    ├── constants.js   # Config: initial state, probabilities, regime tables
    ├── state.js       # State management, save/load (localStorage)
    ├── mechanics.js   # Core logic: interest, defaults, reserves
    ├── admin.js       # Admin panel (toggle with debug flag)
    ├── events.js      # Random event generators
    ├── actions.js     # Player actions: approve, reject, CB desk
    ├── ui.js          # DOM rendering: balance sheet, metrics, logs
    ├── charts.js      # SVG line charts (reserve ratio, NIM, equity)
    └── utils.js       # Formatting: fmtDollar, fmtPct, date helpers
```

No build step. ES modules — run via local server.

## Admin Panel

A hidden admin interface is available when `state.debug === true`. Toggle the **⚙** button to open a modal that lets you override:
- Initial balance sheet values (reserves, loans, deposits, CB borrowing)
- All interest rates (loan, deposit, ECB corridor)
- Economic regime (boom / normal / recession)
- Auto-accept threshold, deposit stability threshold
- Loan demand parameters

You can save/load presets via localStorage. Changes reset the game with the new configuration.

**To enable:** Open browser console and run `getState().debug = true`.

## Module Dependency Order (tick loop)

Each game tick executes operations in a specific order. When adding new features, insert logic at the appropriate position:

1. `accrueInterest` — per-tick interest accumulation
2. `processDefaults` — loan default checks
3. `updateLedgerPnl` — P&L month boundary tracking
4. `processLoanPayments` — monthly amortizing payments
5. `tryDepositFlow` — stochastic deposit inflow/outflow
6. `tryDepositStability` — flight-risk outflows
7. `tryLoanRequest` — stochastic loan request generation
8. `tryEcbChange` — ECB policy rate drift
9. `tryRegimeChange` — Markov chain regime transitions
10. `expireOldLoans` — stale loan request expiry
11. `checkReserves` — auto-borrow from CB if deficient
