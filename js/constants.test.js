import { describe, it, expect } from 'vitest';
import {
  SAVE_KEY, TICKS_PER_QUARTER, TICKS_PER_YEAR, TICKS_PER_MONTH,
  HISTORY_MAX, EVENT_LOG_MAX, NPL_WINDOW, DEFAULT_WINDOW,
  RESERVE_RATIO_TARGET, CB_SPREAD, RATE_MIN, RATE_MAX,
  LOAN_RATE_MIN, LOAN_RATE_MAX, LOAN_RATE_STEP,
  DEPO_RATE_MIN, DEPO_RATE_MAX, DEPO_RATE_STEP,
  LOAN_EXPIRY_TICKS, LOAN_DEFAULT_DURATION,
  DEPO_STABILITY_PROB, DEPO_STABILITY_RATE,
  LOANS_PER_OFFICER, SALARY_PER_OFFICER,
  APPLICATIONS_PER_OFFICER, INSURANCE_ANNUAL_PREMIUM,
  INITIAL, REGIME_MULTIPLIERS, REGIME_TRANSITIONS, REGIME_NAMES,
  REGIME_LOAN_DEMAND, REGIME_ECB_BIAS, REGIME_DEFAULT_RISK,
  REGIME_DEPOSIT_MOD, DEFAULT_ANNUAL_RATE,
  PROB, ECB_RATE_NAMES,
  RESEARCH_BASE_RELATIVE_ERROR, RESEARCH_POINTS_PER_ANALYST,
  ANALYST_SALARY, RESEARCH_AUTO_GRAPH_COST, MAX_RISK_ESTIMATE_LEVEL,
  RESEARCH_ESTIMATE_COSTS, MARKETING_MAX_LEVEL, MARKETING_COST_PER_LEVEL,
  MARKETING_BOOST_PER_LEVEL, MAX_BRANCH_LEVEL, BRANCH_COSTS,
  BRANCH_CAPACITY_BONUS, BRANCH_DEMAND_BONUS,
} from './constants.js';

describe('constants', () => {
  it('has correct time constants', () => {
    expect(TICKS_PER_QUARTER).toBe(180);
    expect(TICKS_PER_YEAR).toBe(720);
    expect(TICKS_PER_MONTH).toBe(60);
    expect(TICKS_PER_YEAR).toBe(TICKS_PER_QUARTER * 4);
    expect(TICKS_PER_MONTH).toBe(TICKS_PER_QUARTER / 3);
  });

  it('has sane rate bounds', () => {
    expect(RATE_MIN).toBe(0);
    expect(RATE_MAX).toBe(10);
    expect(LOAN_RATE_MIN).toBe(0.5);
    expect(LOAN_RATE_MAX).toBe(20);
    expect(LOAN_RATE_STEP).toBe(0.25);
    expect(DEPO_RATE_MIN).toBe(0);
    expect(DEPO_RATE_MAX).toBe(10);
    expect(DEPO_RATE_STEP).toBe(0.25);
  });

  it('has a reserve target below 100%', () => {
    expect(RESERVE_RATIO_TARGET).toBeGreaterThan(0);
    expect(RESERVE_RATIO_TARGET).toBeLessThan(1);
  });

  it('has positive probabilities', () => {
    for (const [key, val] of Object.entries(PROB)) {
      expect(val, `PROB.${key} should be positive`).toBeGreaterThan(0);
      expect(val, `PROB.${key} should be <= 1`).toBeLessThanOrEqual(1);
    }
  });

  it('has all three regimes', () => {
    expect(REGIME_NAMES).toEqual(['boom', 'normal', 'recession']);
  });

  it('has regime multipliers in correct order', () => {
    expect(REGIME_MULTIPLIERS.boom).toBeLessThan(REGIME_MULTIPLIERS.normal);
    expect(REGIME_MULTIPLIERS.normal).toBeLessThan(REGIME_MULTIPLIERS.recession);
  });

  it('has regime transitions summing to ~1', () => {
    for (const [regime, probs] of Object.entries(REGIME_TRANSITIONS)) {
      const sum = probs.reduce((a, b) => a + b, 0);
      expect(sum, `${regime} transitions should sum to 1`).toBeCloseTo(1, 1);
    }
  });

  it('INITIAL has default debug false', () => {
    expect(INITIAL.debug).toBe(false);
  });

  it('INITIAL starts paused with all accounts at zero', () => {
    expect(INITIAL.paused).toBe(true);
    expect(INITIAL.tick).toBe(0);
    expect(INITIAL.loans).toBe(0);
    expect(INITIAL.deposits).toBe(0);
    expect(INITIAL.cbBorrowing).toBe(0);
  });

  it('INITIAL has expected default rate values', () => {
    expect(INITIAL.loanRate).toBe(5.50);
    expect(INITIAL.depositRate).toBe(1.50);
    expect(INITIAL.ecbMroRate).toBe(4.00);
    expect(INITIAL.regime).toBe('normal');
  });

  it('ECB_RATE_NAMES has three entries', () => {
    expect(ECB_RATE_NAMES).toHaveLength(3);
  });

  it('research constants are positive', () => {
    expect(RESEARCH_POINTS_PER_ANALYST).toBeGreaterThan(0);
    expect(ANALYST_SALARY).toBeGreaterThan(0);
    expect(RESEARCH_AUTO_GRAPH_COST).toBeGreaterThan(0);
    expect(MAX_RISK_ESTIMATE_LEVEL).toBeGreaterThan(0);
  });

  it('marketing constants are consistent', () => {
    expect(MARKETING_MAX_LEVEL).toBe(5);
    expect(MARKETING_COST_PER_LEVEL).toBeGreaterThan(0);
    expect(MARKETING_COST_PER_LEVEL).toBe(5000);
    expect(MARKETING_BOOST_PER_LEVEL).toBeGreaterThan(0);
    expect(MARKETING_BOOST_PER_LEVEL).toBe(0.2);
  });

  it('branch expansion constants are consistent', () => {
    expect(MAX_BRANCH_LEVEL).toBe(5);
    expect(BRANCH_COSTS).toHaveLength(MAX_BRANCH_LEVEL);
    expect(BRANCH_COSTS[0]).toBeLessThan(BRANCH_COSTS[1]);
    expect(BRANCH_COSTS[BRANCH_COSTS.length - 1]).toBeGreaterThan(BRANCH_COSTS[0]);
    expect(BRANCH_COSTS).toEqual([10, 20, 40, 80, 160]);
    expect(BRANCH_CAPACITY_BONUS).toBe(5);
    expect(BRANCH_DEMAND_BONUS).toBe(0.15);
  });
});
