/** @module constants - Central game configuration. All tunable parameters, probabilities, regime tables, and initial state defaults live here. */

export const SAVE_KEY = 'bankrunner-state';
export const TICKS_PER_QUARTER = 180;
export const TICKS_PER_YEAR = 720;
export const HISTORY_MAX = 500;
export const EVENT_LOG_MAX = 200;
export const NPL_WINDOW = 60;
export const DEFAULT_WINDOW = 600;
export const RESERVE_RATIO_TARGET = 0.01;
export const CB_SPREAD = 0.25;
export const RATE_MIN = 0;
export const RATE_MAX = 10;
export const LOAN_RATE_MIN = 0.5;
export const LOAN_RATE_MAX = 20;
export const LOAN_RATE_STEP = 0.25;
export const REJECT_THRESHOLD = 20;
export const DEPO_RATE_MIN = 0;
export const DEPO_RATE_MAX = 10;
export const DEPO_RATE_STEP = 0.25;

export const LOAN_EXPIRY_TICKS = 60;
export const LOAN_DEFAULT_DURATION = 720;
export const TICKS_PER_MONTH = 60;
export const DEPO_STABILITY_PROB = 0.002;
export const DEPO_STABILITY_RATE = 0.0005;
export const LOANS_PER_OFFICER = 10;
export const SALARY_PER_OFFICER = 1000;
export const APPLICATIONS_PER_OFFICER = 4;
export const INSURANCE_ANNUAL_PREMIUM = 0.005;

export const INITIAL = {
  tick: 0,
  speed: 10,
  paused: true,
  reserves: 100000,
  loans: 0,
  deposits: 0,
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
  debug: false,
  depositInsurancePct: 0,
  bankRunActive: false,
  bankRunStartTick: 0,
  riskRateMap: [
    { risk: 0, rate: 5.5 },
    { risk: 10, rate: 7.0 },
    { risk: 20, rate: 10.0 },
    { risk: 35, rate: 20.0 },
    { risk: 50, rate: 20.0 },
  ],
  autoCbBorrowing: true,
  weightedLoanRate: 5.50,
  depositStabilityThreshold: 0,
  loanRequestsPerMonth: 20,
  loanDemandPeakPct: 3,
  numWorkers: 1,
  ledgerJournal: [], ledgerBalances: {}, ledgerNextId: 1,   _dailyInt: { depoInt: 0, resInt: 0, cbInt: 0 }, ledgerMonthStart: null, ledgerLastMonth: null,
  loanRecords: [],
  nextLoanRecordId: 1,
  defaultRateHistory: [],
  debugMonthStartEquity: 0
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
