import { Injectable, NgZone, inject } from '@angular/core';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { HOLO_CONFIG } from '../holo.config';
import type { HandFrame, Handedness, TrackedHand, TrackingStatus } from '../types/holo.types';
import { HandSmoother } from './landmark-smoother';
import type { HandTrackingProvider } from './hand-tracking.provider';

/**
 * MediaPipe Hand Landmarker behind the HandTrackingProvider seam.
 *
 * The detection loop runs OUTSIDE Angular's zone: landmarks arrive up to 60×/s
 * and running change detection on each would swamp the UI. Callers decide what,
 * if anything, is worth publishing back into Angular.
 */
@Injectable({ providedIn: 'root' })
export class MediaPipeHandTracking implements HandTrackingProvider {
  private readonly config = inject(HOLO_CONFIG);
  private readonly zone = inject(NgZone);

  private landmarker: HandLandmarker | null = null;
  private initPromise: Promise<void> | null = null;
  private rafId = 0;
  private running = false;
  private lastVideoTime = -1;
  /** One smoother per hand slot, keyed by handedness so hands never share history. */
  private readonly smoothers = new Map<Handedness, HandSmoother>();
  private readonly lastSeenAt = new Map<Handedness, number>();
  private _status: TrackingStatus = 'stopped';

  get status(): TrackingStatus {
    return this._status;
  }

  async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this._status = 'loading';
    this.initPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(this.config.wasmBasePath);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: this.config.modelAssetPath,
          delegate: this.config.preferGpu ? 'GPU' : 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: this.config.maxHands,
        minHandDetectionConfidence: this.config.minHandDetectionConfidence,
        minHandPresenceConfidence: this.config.minHandPresenceConfidence,
        minTrackingConfidence: this.config.minTrackingConfidence,
      });
      this._status = 'stopped';
    })();

    try {
      await this.initPromise;
    } catch (error) {
      this._status = 'error';
      this.initPromise = null;
      throw error;
    }
  }

  start(video: HTMLVideoElement, onFrame: (frame: HandFrame) => void): void {
    if (!this.landmarker || this.running) {
      return;
    }
    this.running = true;
    this._status = 'running';

    // Outside the zone: no change detection per detected frame.
    this.zone.runOutsideAngular(() => {
      const tick = () => {
        if (!this.running) {
          return;
        }
        this.rafId = requestAnimationFrame(tick);

        // Detect once per *video* frame, not once per animation frame — at 30fps
        // capture on a 120Hz display that is a 4× saving for identical output.
        if (video.readyState < 2 || video.currentTime === this.lastVideoTime) {
          return;
        }
        this.lastVideoTime = video.currentTime;

        const timestamp = performance.now();
        try {
          const result = this.landmarker!.detectForVideo(video, timestamp);
          onFrame(this.toFrame(result, timestamp));
        } catch {
          // A single dropped detection must not kill the loop; the next frame retries.
        }
      };
      this.rafId = requestAnimationFrame(tick);
    });
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.lastVideoTime = -1;
    for (const smoother of this.smoothers.values()) {
      smoother.reset();
    }
    this.smoothers.clear();
    this.lastSeenAt.clear();
    if (this._status === 'running') {
      this._status = 'stopped';
    }
  }

  dispose(): void {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
    this.initPromise = null;
    this._status = 'stopped';
  }

  /** Converts a raw MediaPipe result into the normalized, smoothed frame we publish. */
  private toFrame(result: HandLandmarkerResult, timestamp: number): HandFrame {
    const hands: TrackedHand[] = [];
    const seen = new Set<Handedness>();

    for (let i = 0; i < result.landmarks.length; i++) {
      const category = result.handedness[i]?.[0];
      // MediaPipe labels handedness from the camera's point of view; the preview is
      // mirrored, so the label is flipped here to match the hand the user raised.
      const handedness = this.mirrorHandedness(category?.categoryName);
      const confidence = category?.score ?? 0;

      let smoother = this.smoothers.get(handedness);
      if (!smoother) {
        smoother = new HandSmoother(this.config.smoothing);
        this.smoothers.set(handedness, smoother);
      }

      hands.push({
        handedness,
        confidence,
        landmarks: smoother.smooth(
          result.landmarks[i].map((p) => ({ x: p.x, y: p.y, z: p.z })),
          timestamp,
        ),
      });
      seen.add(handedness);
      this.lastSeenAt.set(handedness, timestamp);
    }

    // Tracking loss: a hand gone longer than the grace window drops its history, so
    // it reappears cleanly instead of interpolating from where it vanished.
    for (const [handedness, lastSeen] of [...this.lastSeenAt.entries()]) {
      if (!seen.has(handedness) && timestamp - lastSeen > this.config.trackingLossGraceMs) {
        this.smoothers.get(handedness)?.reset();
        this.smoothers.delete(handedness);
        this.lastSeenAt.delete(handedness);
      }
    }

    return { hands, timestamp };
  }

  private mirrorHandedness(label: string | undefined): Handedness {
    if (label === 'Left') {
      return 'right';
    }
    if (label === 'Right') {
      return 'left';
    }
    return 'unknown';
  }
}
