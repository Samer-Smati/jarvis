import type { Handedness } from '../types/holo.types';
import type { Vec2 } from './landmark.math';

/** Enums rather than string unions: the engine compares and ranks these at
 *  runtime, and a union would give no value to compare against. */
export enum GestureKind {
  NONE = 'none',
  POINT = 'point',
  PINCH = 'pinch',
  GRAB = 'grab',
  PEACE = 'peace',
}

/** Edges, so consumers act on transitions rather than polling levels. */
export enum Phase {
  START = 'start',
  HOLD = 'hold',
  END = 'end',
}

export interface HandGesture {
  kind: GestureKind;
  phase: Phase;
  confidence: number;
  hand: Handedness;
  /** Normalized, already mirrored to match what the user sees. */
  position: Vec2;
  /** Normalized units per second. */
  velocity: Vec2;
  pinchDistance: number;
  /** True on the END frame of a pinch that was short and stayed put. The engine
   *  already separates taps from drags to decide flicks; exposing it stops every
   *  consumer re-deriving the same thresholds and drifting out of step. */
  tap: boolean;
  /** True on the frame a second tap lands inside the double-pinch window. */
  double: boolean;
}

export interface FlickEvent {
  hand: Handedness;
  position: Vec2;
  velocity: Vec2;
  speed: number;
}

export interface TwoHandState {
  active: boolean;
  /** Which pose both hands are holding. Per-hand kinds are suppressed while a
   *  two-hand grip is active, so without this the scene cannot distinguish a
   *  bimanual pinch (zoom/pan) from a bimanual fist (organize). */
  kind: GestureKind.PINCH | GestureKind.GRAB | GestureKind.NONE;
  distance: number;
  /** Distance ratio against gesture start — drives zoom. */
  scale: number;
  midpoint: Vec2;
  /** Radians turned since gesture start. */
  rotation: number;
  /** Midpoint travel since gesture start — drives pan. */
  translation: Vec2;
  confidence: number;
  /** True only on the frame the two-hand grip engages. */
  started: boolean;
}

/** Everything the interaction layer reads for one frame. */
export interface GestureFrame {
  hands: HandGesture[];
  twoHand: TwoHandState;
  flicks: FlickEvent[];
  peace: boolean;
  timestamp: number;
}

/**
 * Gesture priority. A closed fist outranks a pinch, which outranks a bare point,
 * so overlapping poses can never fire two conflicting actions in one frame.
 */
const PRIORITY: Record<GestureKind, number> = {
  [GestureKind.NONE]: 0,
  [GestureKind.POINT]: 1,
  [GestureKind.PINCH]: 2,
  [GestureKind.GRAB]: 3,
  [GestureKind.PEACE]: 4,
};

/** The hand that should drive interaction this frame. */
export function primaryGesture(frame: GestureFrame): HandGesture | null {
  if (!frame.hands.length) {
    return null;
  }
  return [...frame.hands].sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind])[0];
}

export const IDLE_TWO_HAND: TwoHandState = {
  active: false,
  kind: GestureKind.NONE,
  distance: 0,
  scale: 1,
  midpoint: { x: 0.5, y: 0.5 },
  rotation: 0,
  translation: { x: 0, y: 0 },
  confidence: 0,
  started: false,
};
