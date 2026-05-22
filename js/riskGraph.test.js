import { describe, it, expect } from 'vitest';

// Replicate the conversion functions from riskGraph.js for unit testing
const X_MIN = 0, X_MAX = 50;
const COMPRESS_POINT = 20;
const COMPRESS_PORTION = 0.7;
const MARGIN_LEFT = 44;
const INNER_W = 500; // arbitrary fixed width for testing

function xToPx(risk) {
  const clamped = Math.max(X_MIN, Math.min(X_MAX, risk));
  const pivot = MARGIN_LEFT + COMPRESS_PORTION * INNER_W;
  const tail = MARGIN_LEFT + INNER_W;
  if (clamped <= COMPRESS_POINT) {
    const t = (clamped - X_MIN) / (COMPRESS_POINT - X_MIN);
    return MARGIN_LEFT + t * (pivot - MARGIN_LEFT);
  }
  const t = (clamped - COMPRESS_POINT) / (X_MAX - COMPRESS_POINT);
  return pivot + t * (tail - pivot);
}

function pxToX(px) {
  const pivot = MARGIN_LEFT + COMPRESS_PORTION * INNER_W;
  const tail = MARGIN_LEFT + INNER_W;
  if (px <= pivot) {
    const t = (px - MARGIN_LEFT) / (pivot - MARGIN_LEFT);
    return X_MIN + t * (COMPRESS_POINT - X_MIN);
  }
  const t = (px - pivot) / (tail - pivot);
  return COMPRESS_POINT + t * (X_MAX - COMPRESS_POINT);
}

function yToPx(rate, Y_MAX, Y_MIN, MARGIN_TOP, INNER_H) {
  if (rate === null || rate === undefined) rate = 22.5;
  return MARGIN_TOP + (Y_MAX - rate) / (Y_MAX - Y_MIN) * INNER_H;
}

function pxToY(py, Y_MAX, Y_MIN, MARGIN_TOP, INNER_H) {
  return Y_MAX - ((py - MARGIN_TOP) / INNER_H) * (Y_MAX - Y_MIN);
}

const Y_MAX = 25, Y_MIN = 0, MARGIN_TOP = 16, INNER_H = 256;

describe('xToPx — nonlinear risk→pixel mapping', () => {
  it('maps 0% to left edge', () => {
    expect(xToPx(0)).toBe(MARGIN_LEFT);
  });

  it('maps 50% to right edge', () => {
    expect(xToPx(50)).toBe(MARGIN_LEFT + INNER_W);
  });

  it('maps 20% to the compression pivot', () => {
    expect(xToPx(COMPRESS_POINT)).toBe(MARGIN_LEFT + COMPRESS_PORTION * INNER_W);
  });

  it('clamps values below 0', () => {
    expect(xToPx(-10)).toBe(MARGIN_LEFT);
  });

  it('clamps values above 50', () => {
    expect(xToPx(100)).toBe(MARGIN_LEFT + INNER_W);
  });

  it('0..20 portion covers 70% of the width', () => {
    const px0 = xToPx(0);
    const px20 = xToPx(20);
    expect(px20 - px0).toBeCloseTo(COMPRESS_PORTION * INNER_W, 1);
  });

  it('20..50 portion covers 30% of the width', () => {
    const px20 = xToPx(20);
    const px50 = xToPx(50);
    expect(px50 - px20).toBeCloseTo((1 - COMPRESS_PORTION) * INNER_W, 1);
  });

  it('10% is at the midpoint of the 0..20 band', () => {
    const px0 = xToPx(0);
    const px20 = xToPx(20);
    const px10 = xToPx(10);
    expect(px10 - px0).toBeCloseTo((px20 - px0) / 2, 1);
  });

  it('35% is at the midpoint of the 20..50 band', () => {
    const px20 = xToPx(20);
    const px50 = xToPx(50);
    const px35 = xToPx(35);
    expect(px35 - px20).toBeCloseTo((px50 - px20) / 2, 1);
  });
});

describe('pxToX — inverse of xToPx', () => {
  it('inverts xToPx at left edge', () => {
    const px = xToPx(0);
    expect(pxToX(px)).toBeCloseTo(0, 8);
  });

  it('inverts xToPx at right edge', () => {
    const px = xToPx(50);
    expect(pxToX(px)).toBeCloseTo(50, 8);
  });

  it('inverts xToPx at compression point', () => {
    const px = xToPx(20);
    expect(pxToX(px)).toBeCloseTo(20, 8);
  });

  it('inverts xToPx in the compressed band', () => {
    const px = xToPx(35);
    expect(pxToX(px)).toBeCloseTo(35, 5);
  });

  it('inverts xToPx in the expanded band', () => {
    const px = xToPx(10);
    expect(pxToX(px)).toBeCloseTo(10, 5);
  });
});

describe('yToPx / pxToY — linear Y mapping', () => {
  it('maps 0% to bottom', () => {
    expect(yToPx(0, Y_MAX, Y_MIN, MARGIN_TOP, INNER_H)).toBe(MARGIN_TOP + INNER_H);
  });

  it('maps 25% to top', () => {
    expect(yToPx(25, Y_MAX, Y_MIN, MARGIN_TOP, INNER_H)).toBe(MARGIN_TOP);
  });

  it('maps null/undefined rate to the reject zone', () => {
    const rejY = yToPx(null, Y_MAX, Y_MIN, MARGIN_TOP, INNER_H);
    const expected = yToPx(22.5, Y_MAX, Y_MIN, MARGIN_TOP, INNER_H);
    expect(rejY).toBe(expected);
  });

  it('inverts correctly', () => {
    for (const rate of [0, 5, 10, 15, 20, 25]) {
      const py = yToPx(rate, Y_MAX, Y_MIN, MARGIN_TOP, INNER_H);
      const back = pxToY(py, Y_MAX, Y_MIN, MARGIN_TOP, INNER_H);
      expect(back).toBeCloseTo(rate, 5);
    }
  });
});

describe('piecewise consistency', () => {
  it('xToPx is monotonically increasing', () => {
    let last = -Infinity;
    for (let r = 0; r <= 50; r += 0.5) {
      const px = xToPx(r);
      expect(px).toBeGreaterThan(last);
      last = px;
    }
  });

  it('pxToX is monotonically increasing', () => {
    let last = -Infinity;
    for (let p = MARGIN_LEFT; p <= MARGIN_LEFT + INNER_W; p += 10) {
      const x = pxToX(p);
      expect(x).toBeGreaterThan(last);
      last = x;
    }
  });

  it('round-trip fidelity for all integer risk values', () => {
    for (let r = 0; r <= 50; r++) {
      const px = xToPx(r);
      const back = pxToX(px);
      expect(back).toBeCloseTo(r, 4);
    }
  });
});
