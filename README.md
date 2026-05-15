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
| Government bonds | Equity (capital) |

Starting position: $10M deposits, $8M loans, $2M bonds, $100K equity, $100K reserves (1%). Tight start — any new loan immediately strains reserves.

## ECB Corridor

Three policy rates that drift ±25bp in response to simulated economic conditions:

- **Deposit facility** (floor) — what excess reserves earn
- **MRO** (mid) — main refinancing rate, policy signal
- **Marginal lending facility** (ceiling) — penalty rate for borrowing

Interest accrues every tick on loans, deposits, reserves, and CB borrowing at their respective rates.

## Random Events

Each tick (~1 hour) events can fire:
- **Deposit flows** ±$50K–$500K, influenced by your rate vs market
- **Loan requests** $100K–$2M with a default probability estimate
- **Loan defaults** ~3–5% annualized, varies by economic regime
- **ECB rate changes** ~2% chance per tick
- **Regime shifts** between boom / normal / recession — affects loan demand, default risk, deposit flows, and ECB bias

## Project Structure

```
├── index.html         # HTML skeleton
├── css/style.css      # All styles
└── js/
    ├── main.js        # Game loop, event delegation, init
    ├── constants.js   # Config: initial state, probabilities, regime tables
    ├── state.js       # State management, save/load (localStorage)
    ├── mechanics.js   # Core logic: interest, defaults, reserves
    ├── events.js      # Random event generators
    ├── actions.js     # Player actions: approve, reject, CB desk
    ├── ui.js          # DOM rendering: balance sheet, metrics, logs
    ├── charts.js      # SVG line charts (reserve ratio, NIM, equity)
    └── utils.js       # Formatting: fmtDollar, fmtPct, date helpers
```

No build step. ES modules — run via local server.
