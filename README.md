# Bank Runner

A single-page browser game where you play as a commercial bank. Real-time with pause. Dark theme. Vanilla JS, single HTML file, no dependencies.

## Concept

You run a commercial bank. Customers deposit money, customers request loans. You set interest rates, approve loans, and manage reserve requirements. The core mechanic is **realistic credit creation**: when you approve a loan, the deposit is created out of thin air (book money). Reserves are the binding constraint, not deposits.

If reserves fall below the 1% requirement, you must borrow from the central bank's marginal lending facility at a penalty rate. Excess reserves earn the deposit facility rate.

Full sandbox — no win/loss conditions. Keep playing indefinitely even if equity goes negative.

## Tech

| Aspect | Choice |
|---|---|
| File | Single `index.html` — inline CSS + JS |
| Dependencies | None |
| State save | `localStorage`, JSON serialize |
| Charts | Hand-rolled SVG |
| Theme | Dark, minimal, dashboard-style |

## Mechanics

### Balance Sheet (5 slots)

| Assets | Liabilities |
|---|---|
| Reserves (at central bank) | Demand deposits |
| Loans to customers | Central bank borrowing |
| Government bonds | Equity (capital) |

### ECB Corridor (policy rates)

- **Deposit facility rate**: floor — what excess reserves earn
- **MRO rate**: main refinancing rate — policy signal
- **Marginal lending facility rate**: ceiling — penalty borrowing rate

Central bank adjusts rates by ±25bp periodically in response to simulated economic conditions.

### Interest Accrual

Accrued every tick (1 tick = 1 hour):

| Item | Rate | Direction |
|---|---|---|
| Loans | Player-set loan rate | Income |
| Deposits | Player-set deposit rate | Expense |
| Reserves | ECB deposit facility rate | Income |
| CB borrowing | ECB marginal lending rate | Expense |

### Events (random per tick)

- **Deposit flow**: ±$50–$500, influenced by deposit rate vs market
- **Loan request**: $100k–$2M, shown with default probability
- **Loan default**: ~3–5% annualized rate (moderate risk norm)
- **ECB rate change**: ~2% chance per tick
- **Economic regime**: boom / normal / recession

### Player Controls

- **Deposit rate slider**: higher attracts deposits, costs more
- **Loan rate slider**: higher yields more income, reduces demand
- **Approve / Reject**: inline buttons on loan requests in event log
- **CB Desk**: borrow or deposit reserves at standing facility rates
- **Pause/Play**: ⏸ stops time, speeds: 1× / 3× / 10×

## UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│  BANK RUNNER     Q1 2026    [1×][3×][10×]  [▶/⏸]         │
├──────────────────────────┬───────────────────────────────────┤
│ BALANCE SHEET            │ METRICS & RATES                 │
│ ────────────             │ ──────────                      │
│ ASSETS                   │ Reserve ratio: 1.0%  ██░░░░░░   │
│  Reserves  $    100,000  │ Equity:        $100,000         │
│  Loans     $  8,000,000  │ NPL ratio:       0.0%          │
│  Bonds     $  2,000,000  │ NIM:            2.50%          │
│  ────────                │                                │
│  Total    $ 10,100,000   │ Loan rate:  5.50% [━━━●━━━]    │
│                          │ Deposit r:  1.50% [━━●━━━━]    │
│ LIABILITIES              │                                │
│  Deposits $ 10,000,000   │ ECB corridor:                 │
│  CB Loans $          0   │  MLF: 4.25%   MRO: 4.00%      │
│  Equity   $    100,000   │  Depo: 3.75%                  │
│  ────────                │                                │
│  Total    $ 10,100,000   │                                │
├──────────────────────────┴───────────────────────────────────┤
│ EVENT LOG                                                   │
│ [Q1] Loan request: $500,000  (default prob: 4.2%)          │
│       [APPROVE]  [REJECT]                                   │
│ [Q1] Deposit inflow +$120,000                               │
│ [Q1] ECB raises MRO to 4.25%                                │
└──────────────────────────────────────────────────────────────┘
```

## Build Order

| Step | Description |
|---|---|
| 1 | HTML skeleton + CSS dark theme + grid layout |
| 2 | Game state definition + save/load (localStorage) |
| 3 | Balance sheet model + interest accrual (hourly) |
| 4 | Loan approval with credit creation mechanic |
| 5 | Reserve requirement check + CB standing facilities |
| 6 | Interest rate sliders + rate-setting controls |
| 7 | Random event generator (deposits, loans, ECB, defaults, regimes) |
| 8 | Event log with inline approve/reject buttons |
| 9 | Trend charts (SVG — reserve ratio, NIM, equity) |
| 10 | Game loop (setInterval) + pause + speed controls |
| 11 | Polish — responsive layout, formatting, edge cases |

## Starting Position

| Item | Value |
|---|---|
| Deposits | $10,000,000 |
| Equity | $100,000 |
| Reserves | $100,000 (1%) |
| Loans | $8,000,000 |
| Bonds | $2,000,000 |

Tight start — any loan immediately triggers CB borrowing.
