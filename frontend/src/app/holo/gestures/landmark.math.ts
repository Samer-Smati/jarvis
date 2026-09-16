import { LANDMARK, type Landmark } from '../types/holo.types';

export interface Vec2 {
  x: number;
  y: number;
}

export const distance2 = (a: Landmark | Vec2, b: Landmark | Vec2): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const distance3 = (a: Landmark, b: Landmark): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const midpoint = (a: Vec2, b: Vec2): Vec2 => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** Signed angle of b relative to a, in radians, in the range (-pi, pi]. */
export function angleBetween(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Smallest signed difference between two angles, so wrapping past pi does not jump. */
export function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

/**
 * Hand scale: wrist to index MCP. Every other measurement is divided by this, which
 * makes thresholds independent of how far the hand is from the camera — a pinch at
 * arm's length and a pinch at the lens produce the same normalized number.
 */
export function handScale(landmarks: Landmark[]): number {
  // Wrist to MIDDLE knuckle: the most stable segment on the hand, and it barely
  // changes as the fingers move. Every ratio below divides by it, which is what
  // makes the thresholds independent of distance from the camera.
  const scale = distance3(landmarks[LANDMARK.wrist], landmarks[LANDMARK.middleMcp]);
  // Never return 0: a degenerate frame would otherwise divide every ratio to Infinity.
  return scale > 1e-4 ? scale : 1e-4;
}

/** Thumb-tip to index-tip distance, in hand-scale units. */
export function pinchDistance(landmarks: Landmark[]): number {
  return distance3(landmarks[LANDMARK.thumbTip], landmarks[LANDMARK.indexTip]) / handScale(landmarks);
}

const FINGER_TIPS = [LANDMARK.indexTip, LANDMARK.middleTip, LANDMARK.ringTip, LANDMARK.pinkyTip];

/**
 * How extended a finger is: tip distance from the wrist, in hand-scale units.
 * A folded finger sits close to the palm, an extended one reaches well past it.
 */
export function fingerExtension(landmarks: Landmark[], tipIndex: number): number {
  return distance3(landmarks[LANDMARK.wrist], landmarks[tipIndex]) / handScale(landmarks);
}

/** Extensions of index, middle, ring and pinky, in that order. */
export function fingerExtensions(landmarks: Landmark[]): number[] {
  return FINGER_TIPS.map((tip) => fingerExtension(landmarks, tip));
}

/** Mean extension of all four fingers — the cheapest open/closed signal. */
export function meanExtension(landmarks: Landmark[]): number {
  const all = fingerExtensions(landmarks);
  return all.reduce((sum, v) => sum + v, 0) / all.length;
}

/** Index fingertip, used as the pointing cursor. */
export const indexTip = (landmarks: Landmark[]): Vec2 => ({
  x: landmarks[LANDMARK.indexTip].x,
  y: landmarks[LANDMARK.indexTip].y,
});

/**
 * Palm centre. Stable while the fingers close, which is exactly what the "did this
 * tap stay put?" test needs — the fingertip moves as part of pinching, so measuring
 * travel there turns every genuine tap into a drag.
 */
export function palmCenter(landmarks: Landmark[]): Vec2 {
  const wrist = landmarks[LANDMARK.wrist];
  const knuckle = landmarks[LANDMARK.middleMcp];
  return { x: (wrist.x + knuckle.x) / 2, y: (wrist.y + knuckle.y) / 2 };
}

/** Point midway between thumb and index tips — where a pinch actually "holds". */
export function pinchPoint(landmarks: Landmark[]): Vec2 {
  const thumb = landmarks[LANDMARK.thumbTip];
  const index = landmarks[LANDMARK.indexTip];
  return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
}

/** Velocity in normalized units per second. Returns zero for non-advancing time. */
export function velocity(previous: Vec2, current: Vec2, dtMs: number): Vec2 {
  if (dtMs <= 0) {
    return { x: 0, y: 0 };
  }
  const dtSeconds = dtMs / 1000;
  return { x: (current.x - previous.x) / dtSeconds, y: (current.y - previous.y) / dtSeconds };
}

export const magnitude = (v: Vec2): number => Math.hypot(v.x, v.y);

/** Distance between two hands, measured pinch point to pinch point. */
export function twoHandDistance(left: Landmark[], right: Landmark[]): number {
  return distance2(pinchPoint(left), pinchPoint(right));
}

/** Angle of the line joining two hands — the rotation handle for bimanual work. */
export function twoHandAngle(left: Landmark[], right: Landmark[]): number {
  return angleBetween(pinchPoint(left), pinchPoint(right));
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Maps a value in [inMin, inMax] to [0, 1], clamped. Used to turn distances into confidences. */
export function normalize(value: number, inMin: number, inMax: number): number {
  if (inMax === inMin) {
    return 0;
  }
  return clamp((value - inMin) / (inMax - inMin), 0, 1);
}
