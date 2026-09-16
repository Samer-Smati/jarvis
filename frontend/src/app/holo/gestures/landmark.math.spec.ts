import { HOLO_DEFAULT_CONFIG } from '../holo.config';
import type { Landmark } from '../types/holo.types';
import * as m from './landmark.math';
import { makeHand } from './test-hands';

describe('landmark maths', () => {
  it('reads the same pinch at any distance from the camera', () => {
    // The entire threshold scheme rests on this property.
    const near = makeHand('pinch').landmarks;
    const far: Landmark[] = near.map((p) => ({
      x: 0.5 + (p.x - 0.5) * 0.4,
      y: 0.7 + (p.y - 0.7) * 0.4,
      z: p.z,
    }));
    expect(m.pinchDistance(near)).toBeCloseTo(m.pinchDistance(far), 6);
  });

  it('separates a pinch from an open hand across the configured gap', () => {
    const cfg = HOLO_DEFAULT_CONFIG.gestures;
    expect(m.pinchDistance(makeHand('pinch').landmarks)).toBeLessThan(cfg.pinchEnter);
    expect(m.pinchDistance(makeHand('open').landmarks)).toBeGreaterThan(cfg.pinchExit);
  });

  it('measures a fist as more compact than an open hand', () => {
    expect(m.meanExtension(makeHand('fist').landmarks))
      .toBeLessThan(m.meanExtension(makeHand('open').landmarks));
  });

  it('never divides by zero on a degenerate frame', () => {
    const flat: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(m.handScale(flat)).toBeGreaterThan(0);
    expect(Number.isFinite(m.pinchDistance(flat))).toBe(true);
  });

  it('treats non-advancing time as zero velocity rather than infinity', () => {
    expect(m.velocity({ x: 0, y: 0 }, { x: 1, y: 1 }, 0)).toEqual({ x: 0, y: 0 });
    expect(m.velocity({ x: 0, y: 0 }, { x: 1, y: 1 }, -5)).toEqual({ x: 0, y: 0 });
  });

  it('reports velocity per second', () => {
    expect(m.velocity({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 500).x).toBeCloseTo(1, 6);
  });

  it('wraps angle differences the short way round', () => {
    expect(m.angleDelta(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6, 6);
    expect(m.angleDelta(0.1, -0.1)).toBeCloseTo(-0.2, 9);
  });

  it('measures two-hand distance and angle', () => {
    const left = makeHand('pinch', { cx: 0.3, cy: 0.5 }).landmarks;
    const right = makeHand('pinch', { cx: 0.7, cy: 0.5 }).landmarks;
    expect(m.twoHandDistance(left, right)).toBeCloseTo(0.4, 6);
    expect(m.twoHandAngle(left, right)).toBeCloseTo(0, 6);
  });

  it('keeps the palm still while the fingers close', () => {
    // This is why tap detection watches the palm and not the fingertip.
    const open = m.palmCenter(makeHand('open').landmarks);
    const pinched = m.palmCenter(makeHand('pinch').landmarks);
    expect(m.distance2(open, pinched)).toBeLessThan(0.01);

    const tipOpen = m.pinchPoint(makeHand('open').landmarks);
    const tipPinched = m.pinchPoint(makeHand('pinch').landmarks);
    expect(m.distance2(tipOpen, tipPinched)).toBeGreaterThan(m.distance2(open, pinched));
  });

  it('clamps normalize and survives a degenerate range', () => {
    expect(m.normalize(-5, 0, 10)).toBe(0);
    expect(m.normalize(50, 0, 10)).toBe(1);
    expect(m.normalize(5, 0, 10)).toBeCloseTo(0.5);
    expect(m.normalize(1, 2, 2)).toBe(0);
  });
});
