import { InjectionToken } from '@angular/core';
import type { HandFrame, TrackingStatus } from '../types/holo.types';

/**
 * The seam between hand tracking and everything else. Consumers subscribe to
 * normalized HandFrames and never learn which library produced them, so the
 * detector can be swapped without touching gestures, the scene, or the UI.
 */
export interface HandTrackingProvider {
  readonly status: TrackingStatus;
  /** Loads the model. Safe to call repeatedly; only the first call does work. */
  init(): Promise<void>;
  /** Begins detection against a playing video element. */
  start(video: HTMLVideoElement, onFrame: (frame: HandFrame) => void): void;
  /** Halts detection but keeps the loaded model for a cheap restart. */
  stop(): void;
  /** Releases the model and all native memory. */
  dispose(): void;
}

export const HAND_TRACKING_PROVIDER = new InjectionToken<HandTrackingProvider>(
  'HAND_TRACKING_PROVIDER',
);
