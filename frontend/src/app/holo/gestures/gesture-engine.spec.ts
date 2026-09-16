import { HOLO_DEFAULT_CONFIG } from '../holo.config';
import { GestureEngine } from './gesture-engine';
import { GestureKind, Phase } from './gesture.types';
import { feed, feedAll, frameOf, makeHand } from './test-hands';

const phasesOf = (frames: any[]) => frames.filter((f) => f.hands.length).map((f) => f.hands[0].phase);

describe('GestureEngine', () => {
  let engine: GestureEngine;
  beforeEach(() => { engine = new GestureEngine(HOLO_DEFAULT_CONFIG); });

  it('reads an open hand as pointing', () => {
    expect(feed(engine, [makeHand('open')]).hands[0].kind).toBe(GestureKind.POINT);
  });

  it('recognises a pinch with a confidence', () => {
    const out = feed(engine, [makeHand('pinch')]);
    expect(out.hands[0].kind).toBe(GestureKind.PINCH);
    expect(out.hands[0].confidence).toBeGreaterThan(0);
  });

  it('reads a fist as grab, not as a permanent pinch', () => {
    // A fist also brings thumb and index together; grab must win.
    expect(feed(engine, [makeHand('fist')]).hands[0].kind).toBe(GestureKind.GRAB);
  });

  it('never decides a gesture from one frame', () => {
    const out = engine.update(frameOf([makeHand('pinch')], 0));
    expect(out.hands[0].kind).not.toBe(GestureKind.PINCH);
  });

  it('raises START on engage and END on release', () => {
    feed(engine, [makeHand('open')], { start: 0 });
    expect(phasesOf(feedAll(engine, [makeHand('pinch')], { start: 300 }))).toContain(Phase.START);
    expect(phasesOf(feedAll(engine, [makeHand('open')], { start: 900 }))).toContain(Phase.END);
  });

  it('does not chatter while a pinch is held', () => {
    feed(engine, [makeHand('pinch')], { start: 0 });
    const kinds = feedAll(engine, [makeHand('pinch')], { start: 400, count: 8 })
      .map((f) => f.hands[0].kind);
    expect(kinds.every((k) => k === GestureKind.PINCH)).toBe(true);
  });

  it('emits END when the hand leaves frame, so nothing stays stuck', () => {
    feed(engine, [makeHand('pinch')], { start: 0 });
    const out = engine.update(frameOf([], 900));
    expect(out.hands.some((g: any) => g.phase === Phase.END)).toBe(true);
  });

  it('throws with the speed actually gestured, not the speed after stopping', () => {
    feed(engine, [makeHand('pinch', { cx: 0.2 })], { start: 0 });
    for (const [i, x] of [0.35, 0.5, 0.65, 0.8].entries()) {
      engine.update(frameOf([makeHand('pinch', { cx: x })], 300 + i * 16));
    }
    const flicks = feedAll(engine, [makeHand('open', { cx: 0.85 })], { start: 380, step: 16 })
      .flatMap((f) => f.flicks);
    expect(flicks.length).toBeGreaterThan(0);
    expect(flicks[0].speed).toBeGreaterThanOrEqual(HOLO_DEFAULT_CONFIG.gestures.flickVelocity);
  });

  it('does not flick on a slow release', () => {
    feed(engine, [makeHand('pinch', { cx: 0.5 })], { start: 0 });
    const flicks = feedAll(engine, [makeHand('open', { cx: 0.51 })], { start: 1200, step: 120 })
      .flatMap((f) => f.flicks);
    expect(flicks.length).toBe(0);
  });

  it('treats a short still pinch as a tap rather than a throw', () => {
    feed(engine, [makeHand('open')], { start: 0 });
    feed(engine, [makeHand('pinch')], { start: 200, step: 20, count: 4 });
    const frames = feedAll(engine, [makeHand('open')], { start: 300, step: 20 });
    expect(frames.flatMap((f) => f.flicks).length).toBe(0);
  });

  it('fires peace once, then respects the cooldown', () => {
    expect(feedAll(engine, [makeHand('peace')], { start: 0 }).filter((f) => f.peace).length).toBe(1);
    expect(feedAll(engine, [makeHand('peace')], { start: 200, step: 10 }).some((f) => f.peace)).toBe(false);
  });

  it('activates two-hand mode and suppresses per-hand gestures', () => {
    // A bimanual grip must never also drag two objects.
    const out = feed(engine, [
      makeHand('pinch', { cx: 0.3, hand: 'left' }),
      makeHand('pinch', { cx: 0.7, hand: 'right' }),
    ]);
    expect(out.twoHand.active).toBe(true);
    expect(out.hands.every((g: any) => g.kind === GestureKind.NONE)).toBe(true);
    expect(out.flicks.length).toBe(0);
  });

  it('scales zoom with hand separation, both ways', () => {
    feed(engine, [makeHand('pinch', { cx: 0.4, hand: 'left' }), makeHand('pinch', { cx: 0.6, hand: 'right' })]);
    const apart = feed(engine, [
      makeHand('pinch', { cx: 0.25, hand: 'left' }), makeHand('pinch', { cx: 0.75, hand: 'right' }),
    ], { start: 400 });
    expect(apart.twoHand.scale).toBeGreaterThan(1);

    const together = feed(engine, [
      makeHand('pinch', { cx: 0.47, hand: 'left' }), makeHand('pinch', { cx: 0.53, hand: 'right' }),
    ], { start: 800 });
    expect(together.twoHand.scale).toBeLessThan(1);
  });

  it('clamps zoom to the configured limits', () => {
    feed(engine, [makeHand('pinch', { cx: 0.49, hand: 'left' }), makeHand('pinch', { cx: 0.51, hand: 'right' })]);
    const out = feed(engine, [
      makeHand('pinch', { cx: 0.02, hand: 'left' }), makeHand('pinch', { cx: 0.98, hand: 'right' }),
    ], { start: 400 });
    expect(out.twoHand.scale).toBeLessThanOrEqual(HOLO_DEFAULT_CONFIG.twoHand.maxZoom);
  });

  it('ends two-hand mode cleanly when one hand disappears', () => {
    expect(feed(engine, [
      makeHand('pinch', { cx: 0.3, hand: 'left' }), makeHand('pinch', { cx: 0.7, hand: 'right' }),
    ]).twoHand.active).toBe(true);
    expect(feed(engine, [makeHand('pinch', { cx: 0.7, hand: 'right' })], { start: 900 }).twoHand.active).toBe(false);
  });

  it('ignores rotation inside the deadzone', () => {
    const out = feed(engine, [
      makeHand('pinch', { cx: 0.3, cy: 0.5, hand: 'left' }),
      makeHand('pinch', { cx: 0.7, cy: 0.5, hand: 'right' }),
    ]);
    expect(out.twoHand.rotation).toBe(0);
  });

  it('forgets temporal state on reset', () => {
    feed(engine, [makeHand('pinch')]);
    engine.reset();
    expect(engine.update(frameOf([makeHand('pinch')], 0)).hands[0].kind).not.toBe(GestureKind.PINCH);
  });

  it('keeps each hand history separate', () => {
    const out = feed(engine, [
      makeHand('pinch', { cx: 0.3, hand: 'left' }),
      makeHand('open', { cx: 0.7, hand: 'right' }),
    ]);
    const left = out.hands.find((g: any) => g.hand === 'left');
    const right = out.hands.find((g: any) => g.hand === 'right');
    expect(left.kind).toBe(GestureKind.PINCH);
    expect(right.kind).toBe(GestureKind.POINT);
  });
});
