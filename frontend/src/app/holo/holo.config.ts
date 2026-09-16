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
  /** The scene the gestures act on. World units; the renderer matches these. */
  scene: {
    /** Half-extent of the interaction plane in world units — the cursor maps onto it. */
    halfWidth: number;
    halfHeight: number;
    /** Camera distance from the z=0 plane. Drives the perspective a hit test must agree with. */
    focal: number;
    /** Vertical field of view in radians, shared with the three.js camera. */
    fov: number;
    /** Orb and card hit radii in world units. */
    orbRadius: number;
    cardRadius: number;
    /** Ring the folder orbs are arranged on. */
    ringRadius: number;
    /** Radius the cards of an opened orb fan out to. */
    fanRadius: number;
    /** Depth range objects are spread across, so the ring reads as 3D. */
    depthSpread: number;
    /** Extra slack on a hit radius, so a grab does not demand pixel accuracy. */
    grabTolerance: number;
    /** A throw converts normalized hand velocity into world units/sec by this factor. */
    throwScale: number;
    /** Per-second velocity retention for thrown objects — below 1 they settle. */
    damping: number;
    /** Below this speed (world units/sec) a thrown object is parked. */
    restSpeed: number;
    /** Seconds a card takes to ease between layout positions. */
    settleSeconds: number;
    /** Client-side floor between two state reports for the same event. */
    reportThrottleMs: number;
  };
  /** Responsive grid organization. Rows and columns are derived, never fixed. */
  grid: {
    /** Gap between cells, as a multiple of the largest object radius. */
    spacing: number;
    /** Fraction of the interaction plane the grid is allowed to fill. */
    fill: number;
    /** Aspect the solver biases towards when choosing rows vs columns. */
    targetAspect: number;
  };
  /** Proximity response — the hand approaching an object before touching it. */
  proximity: {
    /** World-unit radius within which an object starts responding to the hand. */
    radius: number;
    /** How far the nearest object leans towards the hand, in world units. */
    lean: number;
    /** Extra scale at closest approach. */
    swell: number;
  };
  /** Mouse/keyboard fallback. Pointer input is translated into gesture frames, so
   *  the scene cannot tell which device drove it. */
  pointer: {
    /** Pixels the pointer may drift during a click for it to count as a tap. */
    tapDrift: number;
    /** Milliseconds a press may last and still count as a tap. */
    tapMs: number;
    /** Two clicks closer together than this are a double pinch. */
    doubleClickMs: number;
    /** Wheel notch to zoom factor. */
    wheelSensitivity: number;
    /** Pixels/second above which releasing a drag throws the object. */
    flickVelocity: number;
  };
  /** Presentation switches. Everything here may be turned off without breaking
   *  a single interaction — effects are secondary to usability. */
  effects: {
    effectsEnabled: boolean;
    proximityEnabled: boolean;
    physicsEnabled: boolean;
    /** Multiplies every easing rate. 0.5 is languid, 2 is snappy. */
    animationSpeed: number;
    /** 0..1 emissive/halo strength. */
    glowIntensity: number;
    /** Overlay treatment over the camera feed, 0..1 (the CAM control). */
    cameraIntensity: number;
    /** Decorative grabbable props. */
    propsEnabled: boolean;
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
  // World units are arbitrary but shared: the hit test and the three.js camera
  // read the same numbers, so what looks grabbable is what grabs.
  scene: {
    halfWidth: 4.8,
    halfHeight: 2.9,
    focal: 7.5,
    fov: 0.8,
    orbRadius: 0.62,
    cardRadius: 0.42,
    ringRadius: 2.9,
    fanRadius: 1.75,
    depthSpread: 2.4,
    // A hand held still still wanders a few millimetres; without slack the user
    // has to chase the orb rather than reach for it.
    grabTolerance: 0.35,
    throwScale: 3.2,
    damping: 0.12,
    restSpeed: 0.05,
    settleSeconds: 0.28,
    reportThrottleMs: 400,
  },
  grid: {
    spacing: 2.6,
    fill: 0.86,
    targetAspect: 1.6,
  },
  proximity: {
    radius: 1.5,
    lean: 0.28,
    swell: 0.18,
  },
  pointer: {
    tapDrift: 6,
    tapMs: 320,
    doubleClickMs: 420,
    wheelSensitivity: 0.0016,
    flickVelocity: 900,
  },
  effects: {
    effectsEnabled: true,
    proximityEnabled: true,
    physicsEnabled: true,
    animationSpeed: 1,
    glowIntensity: 0.7,
    cameraIntensity: 0.55,
    propsEnabled: true,
  },
};

export const HOLO_CONFIG = new InjectionToken<HoloConfig>('HOLO_CONFIG', {
  providedIn: 'root',
  factory: () => HOLO_DEFAULT_CONFIG,
});
