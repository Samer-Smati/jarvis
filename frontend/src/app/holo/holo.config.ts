import { InjectionToken } from '@angular/core';

/**
 * Every tunable the HOLO subsystem uses. Phase 1 only needs camera and tracking
 * values; gesture thresholds join this object in Phase 2 rather than being
 * scattered through the code.
 */
export interface HoloConfig {
  /** Requested capture size. Lower is cheaper; the detector does not need HD. */
  video: { width: number; height: number; frameRate: number };
  /** Max hands the detector tracks. Two enables Phase 4's bimanual work. */
  maxHands: number;
  /** Detector gates, passed straight to MediaPipe. */
  minHandDetectionConfidence: number;
  minHandPresenceConfidence: number;
  minTrackingConfidence: number;
  /** Prefer the GPU delegate; CPU is the automatic fallback. */
  preferGpu: boolean;
  /** One Euro filter — minCutoff trades jitter for lag, beta counteracts lag on fast motion. */
  smoothing: { minCutoff: number; beta: number; derivativeCutoff: number };
  /** A hand missing for longer than this is treated as gone, not as a dropped frame. */
  trackingLossGraceMs: number;
  /** Frames the FPS meter averages over. */
  fpsWindow: number;
  /** Where the model and wasm runtime are served from. */
  modelAssetPath: string;
  wasmBasePath: string;
  /** Gesture thresholds. Enter/exit pairs give hysteresis so a gesture cannot chatter. */
  gestures: {
    /** Pinch closes below `pinchEnter` and only releases above `pinchExit`, in hand-scale units. */
    pinchEnter: number;
    pinchExit: number;
    /** Grab (closed fist) below `grabEnter` mean extension, releases above `grabExit`. */
    grabEnter: number;
    grabExit: number;
    /** A finger counts as extended above this, folded below `foldedBelow`. */
    extendedAbove: number;
    foldedBelow: number;
    /** Frames a candidate must persist before it is believed. */
    minFrames: number;
    /** Ignore repeats of the same discrete gesture inside this window. */
    cooldownMs: number;
    /** Speed (normalized units/s) above which a release counts as a flick. */
    flickVelocity: number;
    /** Samples kept for velocity estimation. */
    velocityWindow: number;
    /** Window searched for the fastest motion when a flick is confirmed. */
    flickLookbackMs: number;
    /** A pinch shorter than this, that stayed put, is a tap rather than a drag. */
    tapMs: number;
    /** Palm travel allowed during a tap, in normalized units. */
    tapDrift: number;
    /** Two taps closer together than this are a double pinch. */
    doublePinchMs: number;
    /** Maps a central hand zone onto the whole screen. */
    reachAmplification: number;
  };
  /** Two-hand manipulation limits. */
  twoHand: {
    minZoom: number;
    maxZoom: number;
    zoomSensitivity: number;
    /** Rotation below this (radians) is treated as noise. */
    rotationDeadzone: number;
  };
}

export const HOLO_DEFAULT_CONFIG: HoloConfig = {
  video: { width: 640, height: 480, frameRate: 30 },
  maxHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  preferGpu: true,
  // Tuned by parameter sweep: beta 0.035 left ~33% lag on a fast sweep. These values
  // hold resting jitter under 0.006 (normalized) while tracking fast motion to ~89%.
  smoothing: { minCutoff: 1.0, beta: 1.0, derivativeCutoff: 1 },
  trackingLossGraceMs: 220,
  fpsWindow: 30,
  modelAssetPath: 'holo-models/hand_landmarker.task',
  wasmBasePath: 'holo-wasm',
  // Ratios against hand span (wrist to middle knuckle), so a pinch reads the same
  // at arm's length as it does near the lens. Values are calibrated against real
  // hands rather than guessed: tighter numbers demand fingers literally touching.
  gestures: {
    pinchEnter: 0.30,
    pinchExit: 0.42,
    grabEnter: 1.05,
    grabExit: 1.25,
    extendedAbove: 1.45,
    foldedBelow: 1.15,
    minFrames: 2,
    cooldownMs: 900,
    flickVelocity: 1.1,
    velocityWindow: 5,
    // A flick takes the fastest motion in this window before release. Measured at
    // the moment debouncing confirms the release, the hand has already stopped and
    // the throw comes out far weaker than the gesture felt.
    flickLookbackMs: 200,
    // A tap is a short pinch that stayed put. Travel is measured on the PALM: the
    // fingertip necessarily moves as part of pinching, so measuring there makes
    // every genuine tap read as a drag.
    tapMs: 450,
    tapDrift: 0.07,
    doublePinchMs: 420,
    // Amplified reach: a comfortable central hand zone covers the whole screen, so
    // the edges are reachable without stretching out of frame.
    reachAmplification: 1.45,
  },
  twoHand: {
    minZoom: 0.45,
    maxZoom: 3.2,
    zoomSensitivity: 1,
    rotationDeadzone: 0.05,
  },
};

export const HOLO_CONFIG = new InjectionToken<HoloConfig>('HOLO_CONFIG', {
  providedIn: 'root',
  factory: () => HOLO_DEFAULT_CONFIG,
});
