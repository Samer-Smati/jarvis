import { HOLO_DEFAULT_CONFIG, type HoloConfig } from '../holo.config';
import { LANDMARK, type HandFrame, type Handedness, type Landmark, type TrackedHand } from '../types/holo.types';
import * as m from './landmark.math';
import type { Vec2 } from './landmark.math';
import {
  GestureKind,
  IDLE_TWO_HAND,
  Phase,
  type FlickEvent,
  type GestureFrame,
  type HandGesture,
  type TwoHandState,
} from './gesture.types';

/** Per-hand temporal state. The engine is only deterministic because this is
 *  keyed by handedness — positional keying loses a hand's history whenever the
 *  detector reorders its output, which it does between frames. */
interface HandTrack {
  kind: GestureKind;
  candidate: GestureKind;
  candidateFrames: number;
  positions: Array<{ point: Vec2; at: number }>;
  velocities: Array<{ velocity: Vec2; speed: number; at: number }>;
  engagedAt: number | null;
  engagedPalm: Vec2 | null;
  lastTapAt: number | null;
  lastSeen: number;
}

/**
 * Turns smoothed hand frames into debounced, prioritized gestures.
 *
 * Three rules this class exists to enforce:
 *   1. No gesture is ever decided from a single frame — landmarks are noisy.
 *   2. Every threshold is a pair: engaging uses the near value, releasing the far
 *      one, so a hand resting exactly on the line cannot chatter.
 *   3. Two-hand manipulation suppresses per-hand gestures, so a bimanual zoom can
 *      never also drag two objects.
 *
 * It knows nothing about the camera, the scene, or Angular.
 */
export class GestureEngine {
  private readonly tracks = new Map<Handedness, HandTrack>();
  private twoHandOrigin: { distance: number; angle: number; centre: Vec2 } | null = null;
  private lastPeaceAt: number | null = null;

  constructor(private readonly config: HoloConfig = HOLO_DEFAULT_CONFIG) {}

  /** Drop all temporal state, so a returning hand cannot resume a half-finished
   *  gesture. Called whenever tracking stops. */
  reset(): void {
    this.tracks.clear();
    this.twoHandOrigin = null;
    this.lastPeaceAt = null;
  }

  update(frame: HandFrame): GestureFrame {
    const now = frame.timestamp;
    const gestures: HandGesture[] = [];
    const flicks: FlickEvent[] = [];
    const seen = new Set<Handedness>();

    for (const hand of frame.hands) {
      seen.add(hand.handedness);
      const { gesture, flick } = this.updateHand(hand, now);
      gestures.push(gesture);
      if (flick) {
        flicks.push(flick);
      }
    }

    // A hand that vanished mid-gesture must still emit its END, or whatever it
    // held stays stuck to a hand that is no longer there.
    for (const [handedness, track] of [...this.tracks.entries()]) {
      if (seen.has(handedness)) {
        continue;
      }
      if (now - track.lastSeen > this.config.trackingLossGraceMs) {
        const ended = this.releaseTrack(handedness, track);
        if (ended) {
          gestures.push(ended);
        }
      }
    }

    const twoHand = this.updateTwoHand(frame, gestures, now);
    const peace = this.updatePeace(gestures, now);

    if (twoHand.active) {
      // Suppress per-hand intent while the scene itself is being manipulated.
      return {
        hands: gestures.map((g) => ({ ...g, kind: GestureKind.NONE, phase: Phase.HOLD })),
        twoHand,
        flicks: [],
        peace: false,
        timestamp: now,
      };
    }

    return { hands: gestures, twoHand, flicks, peace, timestamp: now };
  }

  // ------------------------------------------------------------------ per hand

  private updateHand(hand: TrackedHand, now: number): { gesture: HandGesture; flick: FlickEvent | null } {
    const track = this.trackFor(hand.handedness);
    track.lastSeen = now;

    const landmarks = hand.landmarks;
    const pinch = m.pinchDistance(landmarks);
    const grip = m.pinchPoint(landmarks);
    const palm = m.palmCenter(landmarks);

    track.positions.push({ point: grip, at: now });
    if (track.positions.length > 12) {
      track.positions.shift();
    }
    const velocity = this.velocityOf(track);
    track.velocities.push({ velocity, speed: m.magnitude(velocity), at: now });
    if (track.velocities.length > 16) {
      track.velocities.shift();
    }

    const observed = this.classify(track.kind, landmarks, pinch);

    // Debounce: a new pose must persist before it replaces the current one.
    if (observed === track.kind) {
      track.candidate = observed;
      track.candidateFrames = 0;
    } else if (observed === track.candidate) {
      track.candidateFrames += 1;
    } else {
      track.candidate = observed;
      track.candidateFrames = 1;
    }

    const previous = track.kind;
    let phase = Phase.HOLD;
    let tap = false;
    let doubleTap = false;
    let flick: FlickEvent | null = null;

    if (track.candidateFrames >= this.config.gestures.minFrames && observed !== track.kind) {
      track.kind = observed;
      const wasEngaged = GestureEngine.engages(previous);
      const isEngaged = GestureEngine.engages(observed);

      if (wasEngaged && !isEngaged) {
        phase = Phase.END;
        const travelled = track.engagedPalm ? m.distance2(palm, track.engagedPalm) : Infinity;
        const heldFor = track.engagedAt === null ? Infinity : now - track.engagedAt;
        const wasTap = heldFor <= this.config.gestures.tapMs && travelled <= this.config.gestures.tapDrift;

        if (wasTap) {
          tap = true;
          doubleTap =
            track.lastTapAt !== null && now - track.lastTapAt <= this.config.gestures.doublePinchMs;
          track.lastTapAt = now;
        } else {
          const peak = this.peakVelocity(track, now);
          if (peak.speed >= this.config.gestures.flickVelocity) {
            flick = { hand: hand.handedness, position: grip, velocity: peak.velocity, speed: peak.speed };
          }
        }
        track.engagedAt = null;
        track.engagedPalm = null;
      } else if (!wasEngaged && isEngaged) {
        phase = Phase.START;
        track.engagedAt = now;
        track.engagedPalm = palm;
      } else {
        phase = Phase.START;
      }
    }

    return {
      gesture: {
        kind: track.kind,
        phase,
        confidence: this.confidenceOf(track.kind, landmarks, pinch, hand.confidence),
        hand: hand.handedness,
        position: grip,
        velocity,
        pinchDistance: pinch,
        tap,
        double: doubleTap,
      },
      flick,
    };
  }

  /** Pick the pose for this frame, applying hysteresis against the current one. */
  private classify(current: GestureKind, landmarks: Landmark[], pinch: number): GestureKind {
    const cfg = this.config.gestures;
    const [index, middle, ring, pinky] = m.fingerExtensions(landmarks);

    if (
      index > cfg.extendedAbove &&
      middle > cfg.extendedAbove &&
      ring < cfg.foldedBelow &&
      pinky < cfg.foldedBelow
    ) {
      return GestureKind.PEACE;
    }

    // Grab is checked before pinch: a closed fist also brings thumb and index
    // together, so checking pinch first would read every fist as a pinch.
    const grabThreshold = current === GestureKind.GRAB ? cfg.grabExit : cfg.grabEnter;
    if (index < grabThreshold && middle < grabThreshold && ring < grabThreshold && pinky < grabThreshold) {
      return GestureKind.GRAB;
    }

    const pinchThreshold = current === GestureKind.PINCH ? cfg.pinchExit : cfg.pinchEnter;
    if (pinch < pinchThreshold) {
      return GestureKind.PINCH;
    }

    return GestureKind.POINT;
  }

  /** Poses that hold an object. POINT only hovers. */
  private static engages(kind: GestureKind): boolean {
    return kind === GestureKind.PINCH || kind === GestureKind.GRAB;
  }

  /**
   * How firmly the pose is held, scaled by the detector's own confidence. A pinch
   * squeezed well past the threshold is more certain than one hovering on it, and
   * the UI can refuse to act when this is low.
   */
  private confidenceOf(kind: GestureKind, landmarks: Landmark[], pinch: number, detector: number): number {
    const cfg = this.config.gestures;
    let strength: number;
    switch (kind) {
      case GestureKind.PINCH:
        strength = 1 - m.normalize(pinch, 0, cfg.pinchExit);
        break;
      case GestureKind.GRAB:
        strength = 1 - m.normalize(m.meanExtension(landmarks), 0, cfg.grabExit);
        break;
      case GestureKind.PEACE:
        strength = 0.9;
        break;
      case GestureKind.POINT:
        strength = m.normalize(pinch, cfg.pinchExit, 1.2);
        break;
      default:
        strength = 0;
    }
    return Math.round(m.clamp(strength * detector, 0, 1) * 1000) / 1000;
  }

  /** Velocity over the sample window, not frame to frame — one noisy landmark
   *  should not read as a flick. */
  private velocityOf(track: HandTrack): Vec2 {
    if (track.positions.length < 2) {
      return { x: 0, y: 0 };
    }
    const window = Math.min(this.config.gestures.velocityWindow, track.positions.length);
    const start = track.positions[track.positions.length - window];
    const end = track.positions[track.positions.length - 1];
    return m.velocity(start.point, end.point, end.at - start.at);
  }

  /** Fastest motion in the lookback window, so a throw carries the speed the user
   *  actually gestured rather than whatever is left once the hand halts. */
  private peakVelocity(track: HandTrack, now: number): { velocity: Vec2; speed: number } {
    let best = { velocity: { x: 0, y: 0 }, speed: 0 };
    for (const sample of track.velocities) {
      if (now - sample.at <= this.config.gestures.flickLookbackMs && sample.speed > best.speed) {
        best = { velocity: sample.velocity, speed: sample.speed };
      }
    }
    return best;
  }

  private trackFor(handedness: Handedness): HandTrack {
    let track = this.tracks.get(handedness);
    if (!track) {
      track = {
        kind: GestureKind.NONE,
        candidate: GestureKind.NONE,
        candidateFrames: 0,
        positions: [],
        velocities: [],
        engagedAt: null,
        engagedPalm: null,
        lastTapAt: null,
        lastSeen: 0,
      };
      this.tracks.set(handedness, track);
    }
    return track;
  }

  private releaseTrack(handedness: Handedness, track: HandTrack): HandGesture | null {
    this.tracks.delete(handedness);
    if (!GestureEngine.engages(track.kind)) {
      return null;
    }
    const last = track.positions[track.positions.length - 1];
    return {
      kind: GestureKind.NONE,
      phase: Phase.END,
      confidence: 0,
      hand: handedness,
      position: last ? last.point : { x: 0.5, y: 0.5 },
      velocity: { x: 0, y: 0 },
      pinchDistance: 1,
      tap: false,
      double: false,
    };
  }

  // ------------------------------------------------------------------ two hand

  private updateTwoHand(frame: HandFrame, gestures: HandGesture[], now: number): TwoHandState {
    const left = frame.hands.find((h) => h.handedness === 'left');
    const right = frame.hands.find((h) => h.handedness === 'right');
    const engaged = gestures.filter((g) => GestureEngine.engages(g.kind));

    if (!left || !right || engaged.length < 2) {
      this.twoHandOrigin = null;
      return { ...IDLE_TWO_HAND };
    }

    // Both fists is a different intent from both pinches; a mixed grip is
    // ambiguous and stays unclassified rather than guessing at one of them.
    const kind = engaged.every((g) => g.kind === GestureKind.GRAB)
      ? GestureKind.GRAB
      : engaged.every((g) => g.kind === GestureKind.PINCH)
        ? GestureKind.PINCH
        : GestureKind.NONE;

    const distance = m.twoHandDistance(left.landmarks, right.landmarks);
    const angle = m.twoHandAngle(left.landmarks, right.landmarks);
    const centre = m.midpoint(m.pinchPoint(left.landmarks), m.pinchPoint(right.landmarks));

    let started = false;
    if (!this.twoHandOrigin) {
      // Scale and rotation are measured against the grip's origin, not absolutes.
      this.twoHandOrigin = { distance: Math.max(distance, 1e-3), angle, centre };
      started = true;
    }

    const origin = this.twoHandOrigin;
    const cfg = this.config.twoHand;
    const scale = m.clamp(
      1 + (distance / origin.distance - 1) * cfg.zoomSensitivity,
      cfg.minZoom,
      cfg.maxZoom,
    );
    let rotation = m.angleDelta(origin.angle, angle);
    if (Math.abs(rotation) < cfg.rotationDeadzone) {
      rotation = 0;
    }

    return {
      active: true,
      kind,
      distance,
      scale,
      midpoint: centre,
      rotation,
      translation: { x: centre.x - origin.centre.x, y: centre.y - origin.centre.y },
      confidence: Math.min(left.confidence, right.confidence),
      started,
    };
  }

  private updatePeace(gestures: HandGesture[], now: number): boolean {
    if (!gestures.some((g) => g.kind === GestureKind.PEACE)) {
      return false;
    }
    if (this.lastPeaceAt !== null && now - this.lastPeaceAt < this.config.gestures.cooldownMs) {
      return false;
    }
    this.lastPeaceAt = now;
    return true;
  }
}
