import {
  GestureKind,
  IDLE_TWO_HAND,
  Phase,
  type FlickEvent,
  type GestureFrame,
  type HandGesture,
} from '../gestures/gesture.types';
import { HOLO_DEFAULT_CONFIG, type HoloConfig } from '../holo.config';

/** Camera and layout intents the pointer raises that are not object interactions.
 *  A wheel notch is not a two-hand grip, and pretending it is would mean faking a
 *  bimanual pinch — including the grip release that comes with one. */
export type PointerCommand =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'rotate'; radians: number }
  | { kind: 'organize' }
  | { kind: 'reset' }
  | { kind: 'collapse' }
  | { kind: 'toggle-effects' }
  | { kind: 'toggle-debug' };

/** A pointer position already reduced to the 0..1 space gestures work in. */
interface Point {
  x: number;
  y: number;
}

/**
 * Mouse and keyboard fallback.
 *
 * It does not drive the scene directly. It synthesizes the same `GestureFrame`
 * the hand pipeline emits, so the scene engine — and every rule and test in it —
 * is shared by both input devices rather than duplicated for one of them. A
 * press is a pinch, a drag is a held pinch, a quick release is a flick, and a
 * double click is the double pinch that expands a card.
 *
 * Every handler takes plain numbers rather than DOM events, so the whole
 * fallback is testable without a browser; `attach` is the only part that knows
 * events exist.
 */
export class PointerInput {
  private position: Point = { x: 0.5, y: 0.5 };
  private pressed = false;
  private pressedAt = 0;
  private pressOrigin: Point = { x: 0.5, y: 0.5 };
  private pressOriginPx: Point = { x: 0, y: 0 };
  private lastPx: Point = { x: 0, y: 0 };
  private history: Array<{ point: Point; px: Point; at: number }> = [];
  private lastTapAt: number | null = null;
  private pendingPhase: Phase | null = null;
  private pendingTap = false;
  private pendingDouble = false;
  private pendingFlick: FlickEvent | null = null;
  private active = false;

  private detach: Array<() => void> = [];

  constructor(
    private readonly config: HoloConfig = HOLO_DEFAULT_CONFIG,
    private readonly onCommand: (command: PointerCommand) => void = () => undefined,
  ) {}

  /** True once the pointer has been used, so the deck can show a cursor for it. */
  get engaged(): boolean {
    return this.active;
  }

  // ------------------------------------------------------------------- events

  move(xPx: number, yPx: number, width: number, height: number, now: number): void {
    this.active = true;
    this.position = {
      x: width > 0 ? Math.min(Math.max(xPx / width, 0), 1) : 0.5,
      y: height > 0 ? Math.min(Math.max(yPx / height, 0), 1) : 0.5,
    };
    this.lastPx = { x: xPx, y: yPx };
    this.history.push({ point: { ...this.position }, px: { x: xPx, y: yPx }, at: now });
    if (this.history.length > 12) {
      this.history.shift();
    }
  }

  down(now: number): void {
    this.active = true;
    this.pressed = true;
    this.pressedAt = now;
    this.pressOrigin = { ...this.position };
    this.pressOriginPx = { ...this.lastPx };
    this.pendingPhase = Phase.START;
  }

  up(now: number): void {
    if (!this.pressed) {
      return;
    }
    this.pressed = false;
    this.pendingPhase = Phase.END;

    const heldFor = now - this.pressedAt;
    const driftPx = Math.hypot(
      this.lastPx.x - this.pressOriginPx.x,
      this.lastPx.y - this.pressOriginPx.y,
    );
    const cfg = this.config.pointer;

    if (heldFor <= cfg.tapMs && driftPx <= cfg.tapDrift) {
      this.pendingTap = true;
      this.pendingDouble = this.lastTapAt !== null && now - this.lastTapAt <= cfg.doubleClickMs;
      // A double click must not immediately seed a third: clear the anchor once
      // it has been spent, or a triple click reads as two overlapping doubles.
      this.lastTapAt = this.pendingDouble ? null : now;
      return;
    }

    const peak = this.peakVelocity(now);
    if (peak.speedPx >= cfg.flickVelocity) {
      this.pendingFlick = {
        hand: 'right',
        position: { ...this.position },
        velocity: peak.velocity,
        speed: Math.hypot(peak.velocity.x, peak.velocity.y),
      };
    }
  }

  /** Releases a held object without activating anything — used when the pointer
   *  leaves the surface mid-drag, which never produces an `up`. */
  cancel(): void {
    if (!this.pressed) {
      return;
    }
    this.pressed = false;
    this.pendingPhase = Phase.END;
    this.pendingTap = false;
    this.pendingDouble = false;
    this.pendingFlick = null;
  }

  wheel(deltaY: number): void {
    this.active = true;
    this.onCommand({ kind: 'zoom', factor: Math.exp(-deltaY * this.config.pointer.wheelSensitivity) });
  }

  /** Returns true when the key was handled, so the caller can prevent default. */
  key(key: string, shift = false): boolean {
    const pan = 0.35;
    switch (key) {
      case 'g':
      case 'G':
        this.onCommand({ kind: 'organize' });
        return true;
      case 'r':
      case 'R':
        this.onCommand({ kind: 'reset' });
        return true;
      case 'e':
      case 'E':
        this.onCommand({ kind: 'toggle-effects' });
        return true;
      case 'd':
      case 'D':
        this.onCommand({ kind: 'toggle-debug' });
        return true;
      case 'Escape':
        this.onCommand({ kind: 'collapse' });
        return true;
      case '+':
      case '=':
        this.onCommand({ kind: 'zoom', factor: 1.12 });
        return true;
      case '-':
      case '_':
        this.onCommand({ kind: 'zoom', factor: 1 / 1.12 });
        return true;
      case 'ArrowLeft':
        this.onCommand(shift ? { kind: 'rotate', radians: -0.08 } : { kind: 'pan', x: -pan, y: 0 });
        return true;
      case 'ArrowRight':
        this.onCommand(shift ? { kind: 'rotate', radians: 0.08 } : { kind: 'pan', x: pan, y: 0 });
        return true;
      case 'ArrowUp':
        this.onCommand({ kind: 'pan', x: 0, y: pan });
        return true;
      case 'ArrowDown':
        this.onCommand({ kind: 'pan', x: 0, y: -pan });
        return true;
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------- frame

  /**
   * The gesture frame for this tick. Consumed once: the START/END edges and the
   * tap flags are cleared, because the scene acts on transitions and would
   * re-fire an expand on every frame that repeated one.
   */
  frame(now: number): GestureFrame {
    const phase = this.pendingPhase ?? (this.pressed ? Phase.HOLD : Phase.HOLD);
    const kind = this.pressed || this.pendingPhase === Phase.END ? GestureKind.PINCH : GestureKind.POINT;

    const gesture: HandGesture = {
      kind: this.pendingPhase === Phase.END ? GestureKind.POINT : kind,
      phase,
      confidence: 1,
      hand: 'right',
      position: { ...this.position },
      velocity: this.velocity(now),
      pinchDistance: this.pressed ? 0.1 : 0.6,
      tap: this.pendingTap,
      double: this.pendingDouble,
    };

    const flicks = this.pendingFlick ? [this.pendingFlick] : [];

    this.pendingPhase = null;
    this.pendingTap = false;
    this.pendingDouble = false;
    this.pendingFlick = null;

    return {
      hands: this.active ? [gesture] : [],
      twoHand: { ...IDLE_TWO_HAND },
      flicks,
      peace: false,
      timestamp: now,
    };
  }

  /** Forget the pointer entirely — the deck stops drawing a cursor for it. */
  reset(): void {
    this.active = false;
    this.pressed = false;
    this.history = [];
    this.lastTapAt = null;
    this.pendingPhase = null;
    this.pendingTap = false;
    this.pendingDouble = false;
    this.pendingFlick = null;
  }

  // ------------------------------------------------------------------- attach

  /** Wires real DOM events onto the handlers above. Returns a teardown, and every
   *  listener registered here is removed by it — a deck that is opened and closed
   *  repeatedly must not accumulate them. */
  attach(surface: HTMLElement, target: Window | HTMLElement = window): () => void {
    const rect = () => surface.getBoundingClientRect();

    const onMove = (event: PointerEvent) => {
      const r = rect();
      this.move(event.clientX - r.left, event.clientY - r.top, r.width, r.height, performance.now());
    };
    const onDown = (event: PointerEvent) => {
      onMove(event);
      this.down(performance.now());
      surface.setPointerCapture?.(event.pointerId);
    };
    const onUp = (event: PointerEvent) => {
      onMove(event);
      this.up(performance.now());
      surface.releasePointerCapture?.(event.pointerId);
    };
    const onLeave = () => this.cancel();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      this.wheel(event.deltaY);
    };
    const onKey = (event: KeyboardEvent) => {
      // Never swallow keys meant for an input the user is typing into.
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        return;
      }
      if (this.key(event.key, event.shiftKey)) {
        event.preventDefault();
      }
    };

    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointerleave', onLeave);
    surface.addEventListener('wheel', onWheel, { passive: false });
    target.addEventListener('keydown', onKey as EventListener);

    this.detach = [
      () => surface.removeEventListener('pointermove', onMove),
      () => surface.removeEventListener('pointerdown', onDown),
      () => surface.removeEventListener('pointerup', onUp),
      () => surface.removeEventListener('pointerleave', onLeave),
      () => surface.removeEventListener('wheel', onWheel),
      () => target.removeEventListener('keydown', onKey as EventListener),
    ];

    return () => this.release();
  }

  release(): void {
    for (const off of this.detach) {
      off();
    }
    this.detach = [];
    this.reset();
  }

  // ------------------------------------------------------------------ private

  private velocity(now: number): Point {
    if (this.history.length < 2) {
      return { x: 0, y: 0 };
    }
    const start = this.history[0];
    const end = this.history[this.history.length - 1];
    const seconds = (end.at - start.at) / 1000;
    if (seconds <= 0) {
      return { x: 0, y: 0 };
    }
    void now;
    return { x: (end.point.x - start.point.x) / seconds, y: (end.point.y - start.point.y) / seconds };
  }

  /** Fastest sample in the flick window, for the same reason the hand engine uses
   *  one: by release the pointer has usually already slowed. */
  private peakVelocity(now: number): { velocity: Point; speedPx: number } {
    let best = { velocity: { x: 0, y: 0 }, speedPx: 0 };
    for (let i = 1; i < this.history.length; i++) {
      const previous = this.history[i - 1];
      const sample = this.history[i];
      if (now - sample.at > this.config.gestures.flickLookbackMs) {
        continue;
      }
      const seconds = (sample.at - previous.at) / 1000;
      if (seconds <= 0) {
        continue;
      }
      const speedPx = Math.hypot(sample.px.x - previous.px.x, sample.px.y - previous.px.y) / seconds;
      if (speedPx > best.speedPx) {
        best = {
          velocity: {
            x: (sample.point.x - previous.point.x) / seconds,
            y: (sample.point.y - previous.point.y) / seconds,
          },
          speedPx,
        };
      }
    }
    return best;
  }
}
