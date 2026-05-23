import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInitialState, setState } from './state.js';
import { updateUI, updateResearchTab } from './ui.js';

function mockEl(extra) {
  return { innerHTML: '', classList: { toggle: () => {} }, style: {}, ...extra };
}

describe('updateResearchTab', () => {
  let state;
  let body;

  beforeEach(() => {
    state = createInitialState();
    setState(state);
    body = mockEl();
    const doc = { getElementById: (id) => (id === 'researchBody' ? body : null) };
    vi.stubGlobal('document', doc);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders initial research points as 0', () => {
    updateResearchTab();
    expect(body.innerHTML).toContain('⭐ 0');
    expect(body.innerHTML).toContain('research-rp-value');
  });

  it('renders updated research points after accumulation', () => {
    state.researchPoints = 15;
    updateResearchTab();
    expect(body.innerHTML).toContain('⭐ 15');
  });

  it('shows purchase button when RP sufficient for auto-underwriting', () => {
    state.researchPoints = 10;
    updateResearchTab();
    expect(body.innerHTML).toContain('data-action="buy-auto-graph"');
    expect(body.innerHTML).toContain('data-action="buy-auto-graph">Purchase</button>');
  });

  it('disables purchase button when RP insufficient', () => {
    state.researchPoints = 5;
    updateResearchTab();
    expect(body.innerHTML).toContain('data-action="buy-auto-graph" disabled');
  });

  it('shows unlocked message when auto-underwriting purchased', () => {
    state.autoLoanGraphUnlocked = true;
    updateResearchTab();
    expect(body.innerHTML).toContain('PURCHASED');
    expect(body.innerHTML).not.toContain('buy-auto-graph');
  });

  it('enables risk estimate upgrade when RP >= cost', () => {
    state.researchPoints = 3;
    updateResearchTab();
    expect(body.innerHTML).toContain('data-action="buy-risk-estimate">Upgrade to Level 1</button>');
  });

  it('disables risk estimate upgrade when RP < cost', () => {
    state.researchPoints = 2;
    updateResearchTab();
    expect(body.innerHTML).toContain('data-action="buy-risk-estimate" disabled');
  });

  it('disables branch upgrade when RP too low', () => {
    state.researchPoints = 0;
    updateResearchTab();
    expect(body.innerHTML).toContain('data-action="buy-branch" disabled');
  });
});

describe('updateUI top metrics', () => {
  let state;
  let metrics;

  beforeEach(() => {
    state = createInitialState();
    setState(state);
    metrics = mockEl();
    const els = {
      topMetrics: metrics,
      gameDate: mockEl(),
      quarter: mockEl(),
      regimeBadge: mockEl(),
      bsReserves: mockEl(),
      bsLoans: mockEl(),
      bsAssetsTotal: mockEl(),
      bsDeposits: mockEl(),
      bsCbBorrowing: mockEl(),
      bsEquity: mockEl(),
      bsLiabilitiesTotal: mockEl(),
      metricReserveRatio: mockEl(),
      metricEquity: mockEl(),
      metricNim: mockEl(),
      metricNpl: mockEl(),
      depositRateDisplay: mockEl(),
      ecbMlf: mockEl(),
      ecbMro: mockEl(),
      ecbDepo: mockEl(),
      acceptedLoanCount: mockEl(),
      loansBadge: mockEl(),
      complianceBody: mockEl(),
      pnlBody: mockEl(),
    };
    // Make getElementById return proper textContent by default
    const doc = { getElementById: (id) => els[id] || null };
    vi.stubGlobal('document', doc);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders research points in top metrics bar', () => {
    state.researchPoints = 7;
    updateUI();
    expect(metrics.innerHTML).toContain('Research');
    expect(metrics.innerHTML).toContain('>7<');
  });

  it('shows 0 research points when none earned', () => {
    updateUI();
    expect(metrics.innerHTML).toContain('>0<');
  });
});
