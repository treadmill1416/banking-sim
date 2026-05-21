import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInitialState, getState, setState, addEvent, reset } from './state.js';
import { INITIAL, SAVE_KEY } from './constants.js';

beforeEach(() => {
  setState(null);
  const store = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = val; }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
  });
});

describe('createInitialState', () => {
  it('returns a deep clone of INITIAL', () => {
    const s = createInitialState();
    expect(s).not.toBe(INITIAL);
    expect(s.loanRate).toBe(INITIAL.loanRate);
    expect(s.regime).toBe(INITIAL.regime);
    expect(s.debug).toBe(false);
  });

  it('returns a fresh copy each call', () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).not.toBe(b);
    a.loanRate = 99;
    expect(b.loanRate).toBe(5.50);
  });
});

describe('getState / setState', () => {
  it('getState returns null initially', () => {
    expect(getState()).toBeNull();
  });

  it('setState replaces the singleton', () => {
    const obj = { test: true };
    setState(obj);
    expect(getState()).toBe(obj);
  });
});

describe('addEvent', () => {
  it('adds an event entry to the log', () => {
    const s = createInitialState();
    const entry = addEvent(s, 'loan', 'Test loan event', 'event-income');
    expect(entry.id).toBe(1);
    expect(entry.type).toBe('loan');
    expect(entry.msg).toBe('Test loan event');
    expect(entry.cls).toBe('event-income');
    expect(s.eventLog[0]).toBe(entry);
  });

  it('auto-increments nextEventId', () => {
    const s = createInitialState();
    addEvent(s, 'loan', 'First');
    addEvent(s, 'deposit', 'Second');
    expect(s.nextEventId).toBe(3);
  });

  it('prepends events to the log', () => {
    const s = createInitialState();
    addEvent(s, 'loan', 'First');
    addEvent(s, 'deposit', 'Second');
    expect(s.eventLog[0].msg).toBe('Second');
    expect(s.eventLog[1].msg).toBe('First');
  });

  it('adds quarter and year metadata', () => {
    const s = createInitialState();
    s.tick = 720;
    const entry = addEvent(s, 'test', 'msg');
    expect(entry.quarter).toBe('Q1 2027');
  });

  it('merges extra properties', () => {
    const s = createInitialState();
    const entry = addEvent(s, 'loan', 'msg', 'event-income', { loanAmount: 50000, defaultProb: 2 });
    expect(entry.loanAmount).toBe(50000);
    expect(entry.defaultProb).toBe(2);
  });

  it('respects EVENT_LOG_MAX by dropping oldest entries', () => {
    const s = createInitialState();
    for (let i = 0; i < 250; i++) {
      addEvent(s, 'test', 'event-' + i);
    }
    expect(s.eventLog.length).toBeLessThanOrEqual(200);
  });
});

describe('reset', () => {
  it('creates a fresh initial state', () => {
    const s = createInitialState();
    s.loanRate = 99;
    setState(s);
    reset();
    const fresh = getState();
    expect(fresh.loanRate).toBe(5.50);
    expect(fresh.tick).toBe(0);
  });
});
