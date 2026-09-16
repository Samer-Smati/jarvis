/** A single hand landmark in MediaPipe's normalized space (x/y in 0..1, z relative to wrist). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type Handedness = 'left' | 'right' | 'unknown';

/** One hand in a frame, already smoothed and normalized — no library types leak past this. */
export interface TrackedHand {
  handedness: Handedness;
  /** 21 landmarks, MediaPipe ordering (0 = wrist, 4 = thumb tip, 8 = index tip). */
  landmarks: Landmark[];
  /** Detector's handedness confidence, 0..1. */
  confidence: number;
}

/** One processed detection frame handed to the rest of JARVIS. */
export interface HandFrame {
  hands: TrackedHand[];
  /** performance.now() of the video frame this came from. */
  timestamp: number;
}

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'denied'
  | 'unavailable'
  | 'in-use'
  | 'insecure-context'
  | 'error';

export type TrackingStatus = 'stopped' | 'loading' | 'running' | 'error';

/** What the debug overlay and any future consumer can read about the live session. */
export interface HoloDiagnostics {
  cameraStatus: CameraStatus;
  trackingStatus: TrackingStatus;
  fps: number;
  handCount: number;
  leftConfidence: number | null;
  rightConfidence: number | null;
  lastError: string | null;
}

/** Landmark indices used across the subsystem, named so call sites stay readable. */
export const LANDMARK = {
  wrist: 0,
  thumbTip: 4,
  indexMcp: 5,
  indexTip: 8,
  middleMcp: 9,
  middleTip: 12,
  ringTip: 16,
  pinkyTip: 20,
} as const;
