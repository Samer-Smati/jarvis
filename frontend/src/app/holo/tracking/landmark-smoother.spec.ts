import { HandSmoother } from './landmark-smoother';
import { HOLO_DEFAULT_CONFIG } from '../holo.config';
import type { Landmark } from '../types/holo.types';

const CONFIG = HOLO_DEFAULT_CONFIG.smoothing;
const hand = (x: number): Landmark[] => [{ x, y: x, z: 0 }];

describe('HandSmoother (One Euro)', () => {
  it('passes the first sample through untouched', () => {
    const smoother = new HandSmoother(CONFIG);
    expect(smoother.smooth(hand(0.5), 0)[0].x).toBe(0.5);
  });

  it('suppresses jitter around a resting position', () => {
    const smoother = new HandSmoother(CONFIG);
    smoother.smooth(hand(0.5), 0);
    // Alternating noise around 0.5 should stay far nearer 0.5 than the raw signal.
    let last = 0;
    for (let i = 1; i <= 10; i++) {
      last = smoother.smooth(hand(i % 2 ? 0.55 : 0.45), i * 33)[0].x;
    }
    expect(Math.abs(last - 0.5)).toBeLessThan(0.04);
  });

  it('tracks a fast sustained move without stalling', () => {
    const smoother = new HandSmoother(CONFIG);
    smoother.smooth(hand(0), 0);
    let value = 0;
    for (let i = 1; i <= 12; i++) {
      value = smoother.smooth(hand(i * 0.08), i * 33)[0].x;
    }
    // Must have covered most of the distance to the raw 0.96, not lagged badly behind.
    expect(value).toBeGreaterThan(0.85);
  });

  it('survives duplicate timestamps without producing NaN', () => {
    const smoother = new HandSmoother(CONFIG);
    smoother.smooth(hand(0.2), 100);
    const out = smoother.smooth(hand(0.9), 100);
    expect(Number.isFinite(out[0].x)).toBe(true);
  });

  it('forgets history after reset so a returning hand does not lerp from a stale pose', () => {
    const smoother = new HandSmoother(CONFIG);
    for (let i = 0; i < 8; i++) {
      smoother.smooth(hand(0.1), i * 33);
    }
    smoother.reset();
    expect(smoother.smooth(hand(0.9), 500)[0].x).toBe(0.9);
  });

  it('smooths every landmark independently', () => {
    const smoother = new HandSmoother(CONFIG);
    const first = smoother.smooth([{ x: 0.1, y: 0.1, z: 0 }, { x: 0.9, y: 0.9, z: 0 }], 0);
    expect(first[0].x).toBe(0.1);
    expect(first[1].x).toBe(0.9);
  });
});
