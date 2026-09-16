import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { CameraService } from '../camera/camera.service';
import { HOLO_CONFIG } from '../holo.config';
import { MediaPipeHandTracking } from '../tracking/mediapipe-hand-tracking.service';
import type { CameraStatus, HandFrame, HoloDiagnostics, TrackingStatus } from '../types/holo.types';
import { FpsMeter } from './fps-meter';

/** How often live tracking state is pushed into Angular. 10Hz is smooth to read and cheap. */
const UI_PUBLISH_INTERVAL_MS = 100;

/**
 * Owns one HOLO session: camera on, model loaded, frames flowing, and the small
 * amount of state the UI is allowed to see.
 *
 * The newest frame is kept on a plain field updated at full rate; only a 10Hz
 * summary reaches Angular signals. Consumers that need every frame (the debug
 * overlay, and later the gesture engine) read `latestFrame` from their own loop.
 */
@Injectable({ providedIn: 'root' })
export class HoloSessionService {
  private readonly config = inject(HOLO_CONFIG);
  private readonly camera = inject(CameraService);
  private readonly tracking = inject(MediaPipeHandTracking);
  private readonly zone = inject(NgZone);

  private readonly fpsMeter = new FpsMeter(this.config.fpsWindow);
  private lastPublishAt = 0;

  /** Hot path — written every frame, never a signal. */
  latestFrame: HandFrame = { hands: [], timestamp: 0 };

  readonly cameraStatus = signal<CameraStatus>('idle');
  readonly trackingStatus = signal<TrackingStatus>('stopped');
  readonly fps = signal(0);
  readonly handCount = signal(0);
  readonly leftConfidence = signal<number | null>(null);
  readonly rightConfidence = signal<number | null>(null);
  readonly lastError = signal<string | null>(null);

  readonly isActive = computed(
    () => this.cameraStatus() === 'ready' && this.trackingStatus() === 'running',
  );

  readonly diagnostics = computed<HoloDiagnostics>(() => ({
    cameraStatus: this.cameraStatus(),
    trackingStatus: this.trackingStatus(),
    fps: this.fps(),
    handCount: this.handCount(),
    leftConfidence: this.leftConfidence(),
    rightConfidence: this.rightConfidence(),
    lastError: this.lastError(),
  }));

  /** Turns HOLO on: camera, then model, then the detection loop. */
  async start(video: HTMLVideoElement): Promise<void> {
    this.lastError.set(null);
    this.cameraStatus.set('requesting');

    const result = await this.camera.open();
    this.cameraStatus.set(result.status);
    if (!result.stream) {
      this.lastError.set(result.error);
      return;
    }

    video.srcObject = result.stream;
    try {
      await video.play();
    } catch (error) {
      this.lastError.set(`Camera preview failed: ${(error as Error).message}`);
    }

    this.trackingStatus.set('loading');
    try {
      await this.tracking.init();
    } catch (error) {
      this.trackingStatus.set('error');
      this.lastError.set(`Hand model failed to load: ${(error as Error).message}`);
      this.camera.close();
      this.cameraStatus.set('idle');
      return;
    }

    this.fpsMeter.reset();
    this.tracking.start(video, (frame) => this.onFrame(frame));
    this.trackingStatus.set(this.tracking.status);
  }

  /** Turns HOLO off and releases the camera. Safe to call when already stopped. */
  stop(video?: HTMLVideoElement): void {
    this.tracking.stop();
    this.camera.close();
    if (video) {
      video.srcObject = null;
    }
    this.latestFrame = { hands: [], timestamp: 0 };
    this.fpsMeter.reset();
    this.cameraStatus.set('idle');
    this.trackingStatus.set('stopped');
    this.fps.set(0);
    this.handCount.set(0);
    this.leftConfidence.set(null);
    this.rightConfidence.set(null);
  }

  /** Full teardown, including the loaded model. */
  dispose(video?: HTMLVideoElement): void {
    this.stop(video);
    this.tracking.dispose();
  }

  /**
   * Runs outside Angular. Keeps the frame on a field at full rate and only
   * re-enters the zone at UI_PUBLISH_INTERVAL_MS to move signals.
   */
  private onFrame(frame: HandFrame): void {
    this.latestFrame = frame;
    const fps = this.fpsMeter.sample(frame.timestamp);

    if (frame.timestamp - this.lastPublishAt < UI_PUBLISH_INTERVAL_MS) {
      return;
    }
    this.lastPublishAt = frame.timestamp;

    const left = frame.hands.find((h) => h.handedness === 'left') ?? null;
    const right = frame.hands.find((h) => h.handedness === 'right') ?? null;

    this.zone.run(() => {
      this.fps.set(fps);
      this.handCount.set(frame.hands.length);
      this.leftConfidence.set(left ? Math.round(left.confidence * 100) / 100 : null);
      this.rightConfidence.set(right ? Math.round(right.confidence * 100) / 100 : null);
      this.trackingStatus.set(this.tracking.status);
    });
  }
}
