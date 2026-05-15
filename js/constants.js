export const SAVE_KEY = 'bankrunner-state';
export const TICKS_PER_QUARTER = 2190;
export const TICKS_PER_YEAR = 8760;
export const HISTORY_MAX = 500;
export const EVENT_LOG_MAX = 200;
export const NPL_WINDOW = 720;
export const DEFAULT_WINDOW = 7200;
export const RESERVE_RATIO_TARGET = 0.01;
export const CB_SPREAD = 0.25;
export const RATE_MIN = 0;
export const RATE_MAX = 10;
export const LOAN_RATE_MIN = 0.5;
export const LOAN_RATE_MAX = 20;
export const LOAN_RATE_STEP = 0.25;
export const DEPO_RATE_MIN = 0;
export const DEPO_RATE_MAX = 10;
export const DEPO_RATE_STEP = 0.25;

export const LOAN_EXPIRY_TICKS = 24;

export const INITIAL = {
  tick: 0,
  speed: 10,
  paused: true,
  reserves: 100000,
  loans: 8000000,
  bonds: 2000000,
  deposits: 10000000,
  cbBorrowing: 0,
  loanRate: 5.50,
  depositRate: 1.50,
  ecbDepositRate: 3.75,
  ecbMroRate: 4.00,
  ecbMlfRate: 4.25,
  regime: 'normal',
  eventLog: [],
  nextEventId: 1,
  historyRR: [],
  historyNIM: [],
  historyEQ: [],
  pendingLoans: {},
  cumulativeDefaults: 0,
  defaultTicks: [],
  defaultAmounts: [],
  autoAcceptThreshold: 0,
  autoCbBorrowing: true,
  weightedLoanRate: 5.50
};

export const REGIME_MULTIPLIERS = { boom: 0.5, normal: 1, recession: 2.5 };
export const REGIME_TRANSITIONS = { boom: [0.1, 0.8, 0.1], normal: [0.05, 0.9, 0.05], recession: [0.1, 0.8, 0.1] };
export const REGIME_NAMES = ['boom', 'normal', 'recession'];
export const REGIME_LOAN_DEMAND = { boom: 1.8, normal: 1.0, recession: 0.4 };
export const REGIME_ECB_BIAS = { boom: 0.6, normal: 0.5, recession: 0.3 };
export const REGIME_DEFAULT_RISK = { boom: 0.4, normal: 1, recession: 2.5 };
export const REGIME_DEPOSIT_MOD = { boom: 1.5, normal: 1, recession: 0.4 };
export const DEFAULT_ANNUAL_RATE = 0.04;

export const PROB = {
  depositFlow: 0.12,
  loanRequest: 0.06,
  ecbChange: 0.02,
  regimeChange: 0.003,
  defaultHit: 0.15
};

export const ECB_RATE_NAMES = ['Deposit facility', 'MRO', 'Marginal lending facility'];
