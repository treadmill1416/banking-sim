import { describe, it, expect } from 'vitest';
import { fmtDollar, fmtPct, fmtCompact, fmtTicks, gameDateStr, quarterStr } from './utils.js';

describe('fmtDollar', () => {
  it('returns "—" for null/undefined/NaN', () => {
    expect(fmtDollar(null)).toBe('—');
    expect(fmtDollar(undefined)).toBe('—');
    expect(fmtDollar(NaN)).toBe('—');
  });

  it('returns "$0" for near-zero values', () => {
    expect(fmtDollar(0)).toBe('$0');
    expect(fmtDollar(0.4)).toBe('$0');
  });

  it('formats thousands with K', () => {
    expect(fmtDollar(1500)).toBe('$1.5K');
    expect(fmtDollar(10000)).toBe('$10.0K');
    expect(fmtDollar(999500)).toBe('$999.5K');
  });

  it('formats millions with M', () => {
    expect(fmtDollar(1e6)).toBe('$1.00M');
    expect(fmtDollar(1.5e6)).toBe('$1.50M');
    expect(fmtDollar(10e6)).toBe('$10.00M');
  });

  it('formats billions with B', () => {
    expect(fmtDollar(1e9)).toBe('$1.00B');
    expect(fmtDollar(2.5e9)).toBe('$2.50B');
  });

  it('formats negative values', () => {
    expect(fmtDollar(-1500)).toBe('-$1.5K');
    expect(fmtDollar(-2e6)).toBe('-$2.00M');
  });
});

describe('fmtCompact', () => {
  it('returns "—" for null/undefined/NaN', () => {
    expect(fmtCompact(null)).toBe('—');
    expect(fmtCompact(undefined)).toBe('—');
    expect(fmtCompact(NaN)).toBe('—');
  });

  it('returns "0" for near-zero', () => {
    expect(fmtCompact(0)).toBe('0');
    expect(fmtCompact(0.4)).toBe('0');
  });

  it('formats thousands with K suffix (≤4 chars)', () => {
    const result = fmtCompact(500000);
    expect(result).toBe('500K');
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it('formats millions with M suffix (≤4 chars)', () => {
    expect(fmtCompact(5e6)).toBe('5M');
    expect(fmtCompact(5.5e6)).toBe('5.5M');
    expect(fmtCompact(50e6)).toBe('50M');
    expect(fmtCompact(8e6)).toBe('8M');
  });

  it('formats billions with B suffix (≤4 chars)', () => {
    expect(fmtCompact(1.5e9)).toBe('1.5B');
    expect(fmtCompact(10e9)).toBe('10B');
  });

  it('formats small numbers without suffix (≤4 chars)', () => {
    expect(fmtCompact(5)).toBe('5');
    expect(fmtCompact(5.5)).toBe('5.5');
    expect(fmtCompact(0.5)).toBe('0.5');
  });

  it('formats negative values', () => {
    expect(fmtCompact(-500000)).toBe('-500K');
    expect(fmtCompact(-5e6)).toBe('-5M');
  });

  it('never exceeds 4 characters', () => {
    for (const v of [0, 5, 999, 1000, 500000, 5e6, 5.5e6, 1e9, 1.5e9, 10e9]) {
      expect(fmtCompact(v).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('fmtPct', () => {
  it('returns "—" for null/undefined/NaN', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
    expect(fmtPct(NaN)).toBe('—');
  });

  it('formats as percentage with 2 decimals', () => {
    expect(fmtPct(5.5)).toBe('5.50%');
    expect(fmtPct(0)).toBe('0.00%');
    expect(fmtPct(12.345)).toBe('12.35%');
  });
});

describe('fmtTicks', () => {
  it('returns "—" for null/negative', () => {
    expect(fmtTicks(null)).toBe('—');
    expect(fmtTicks(-1)).toBe('—');
  });

  it('shows only days for < 1 month', () => {
    expect(fmtTicks(0)).toBe('0d');
    expect(fmtTicks(2)).toBe('1d');
  });

  it('shows months and days', () => {
    const ticks = 60 + 4; // 1 month + 2 days
    const result = fmtTicks(ticks);
    expect(result).toContain('mo');
  });

  it('shows years', () => {
    const result = fmtTicks(720);
    expect(result).toContain('y');
  });
});

describe('gameDateStr', () => {
  it('starts at Jan 1, 2026 00:00', () => {
    expect(gameDateStr(0)).toBe('Jan 1, 2026 00:00');
  });

  it('advances correctly', () => {
    const later = gameDateStr(720);
    expect(later).toContain('Dec 27, 2026');
  });
});

describe('quarterStr', () => {
  it('returns Q1 2026 at tick 0', () => {
    expect(quarterStr(0)).toBe('Q1 2026');
  });

  it('returns Q2 after one quarter', () => {
    expect(quarterStr(180)).toBe('Q2 2026');
  });

  it('advances year after 4 quarters', () => {
    expect(quarterStr(720)).toBe('Q1 2027');
  });
});
