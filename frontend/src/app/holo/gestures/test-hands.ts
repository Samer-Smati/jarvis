import { type HandFrame, type Landmark, type TrackedHand } from '../types/holo.types';

/** A neutral 21-landmark hand, roughly anatomical, wrist at the pose origin. */
const BASE: Array<[number, number]> = [
  [0.50, 0.90],
  [0.44, 0.86], [0.40, 0.81], [0.37, 0.76], [0.35, 0.72],
  [0.46, 0.72], [0.45, 0.64], [0.44, 0.59], [0.44, 0.54],
  [0.50, 0.71], [0.50, 0.62], [0.50, 0.56], [0.50, 0.51],
  [0.54, 0.72], [0.55, 0.64], [0.56, 0.59], [0.56, 0.55],
  [0.58, 0.74], [0.60, 0.68], [0.61, 0.64], [0.61, 0.60],
];

export type Pose = 'open' | 'pinch' | 'fist' | 'peace';

/**
 * Build a hand in one of the poses the engine must distinguish. Synthetic hands
 * are what let the whole gesture layer be tested with no camera attached.
 */
export function makeHand(
  pose: Pose = 'open',
  options: { cx?: number; cy?: number; hand?: 'left' | 'right'; confidence?: number } = {},
): TrackedHand {
  const { cx = 0.5, cy = 0.7, hand = 'right', confidence = 0.95 } = options;
  const points = BASE.map(([x, y]) => [x, y] as [number, number]);

  const pullToWrist = (indices: number[], factor: number) => {
    const [wx, wy] = points[0];
    for (const i of indices) {
      points[i][0] = wx + (points[i][0] - wx) * factor;
      points[i][1] = wy + (points[i][1] - wy) * factor;
    }
  };

  if (pose === 'pinch') {
    points[4] = [points[8][0], points[8][1]];          // thumb tip onto index tip
  } else if (pose === 'fist') {
    pullToWrist([1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20], 0.28);
  } else if (pose === 'peace') {
    pullToWrist([13, 14, 15, 16, 17, 18, 19, 20], 0.34);
  }

  const dx = cx - BASE[0][0];
  const dy = cy - BASE[0][1];
  const landmarks: Landmark[] = points.map(([x, y]) => ({ x: x + dx, y: y + dy, z: 0 }));
  return { handedness: hand, landmarks, confidence };
}

export function frameOf(hands: TrackedHand[], timestamp = 0): HandFrame {
  return { hands, timestamp };
}

/** Push input through the engine and return EVERY frame. Gesture starts, ends and
 *  flicks are edges — a helper returning only the last frame hides them. */
export function feedAll(
  engine: { update(f: HandFrame): unknown },
  hands: TrackedHand[],
  options: { start?: number; step?: number; count?: number } = {},
): any[] {
  const { start = 0, step = 33, count = 6 } = options;
  const out: any[] = [];
  for (let i = 0; i < count; i++) {
    out.push(engine.update(frameOf(hands, start + i * step)));
  }
  return out;
}

/** Settled state once the input has cleared debouncing. */
export function feed(
  engine: { update(f: HandFrame): unknown },
  hands: TrackedHand[],
  options: { start?: number; step?: number; count?: number } = {},
): any {
  const frames = feedAll(engine, hands, options);
  return frames[frames.length - 1];
}
