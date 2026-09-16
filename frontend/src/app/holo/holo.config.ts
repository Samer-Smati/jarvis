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
};

export const HOLO_CONFIG = new InjectionToken<HoloConfig>('HOLO_CONFIG', {
  providedIn: 'root',
  factory: () => HOLO_DEFAULT_CONFIG,
});
