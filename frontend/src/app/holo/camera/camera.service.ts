import { Injectable, inject } from '@angular/core';
import { HOLO_CONFIG } from '../holo.config';
import type { CameraStatus } from '../types/holo.types';

export interface CameraOpenResult {
  status: CameraStatus;
  stream: MediaStream | null;
  error: string | null;
}

/**
 * Owns the webcam for HOLO and nothing else. No tracking, no gestures, no UI —
 * it hands back a MediaStream and guarantees the device is released on stop.
 * JARVIS's voice pipeline holds its own audio-only stream; the two never share.
 */
@Injectable({ providedIn: 'root' })
export class CameraService {
  private readonly config = inject(HOLO_CONFIG);
  private stream: MediaStream | null = null;

  get isOpen(): boolean {
    return !!this.stream;
  }

  get activeStream(): MediaStream | null {
    return this.stream;
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /**
   * getUserMedia needs a secure context. localhost counts as secure, so dev works;
   * a LAN IP over plain http does not, and that is worth naming before we ask.
   */
  static isSecureContext(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  }

  async open(): Promise<CameraOpenResult> {
    if (this.stream) {
      return { status: 'ready', stream: this.stream, error: null };
    }
    if (!CameraService.isSupported()) {
      return { status: 'unavailable', stream: null, error: 'This browser has no camera API.' };
    }
    if (!CameraService.isSecureContext()) {
      return {
        status: 'insecure-context',
        stream: null,
        error: 'The camera needs HTTPS (or localhost). Open JARVIS over https and try again.',
      };
    }

    try {
      const { width, height, frameRate } = this.config.video;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: frameRate },
          facingMode: 'user',
        },
      });
      return { status: 'ready', stream: this.stream, error: null };
    } catch (error) {
      return this.classify(error);
    }
  }

  /** Stops every track and drops the reference, so the browser's camera light goes out. */
  close(): void {
    if (!this.stream) {
      return;
    }
    for (const track of this.stream.getTracks()) {
      track.stop();
    }
    this.stream = null;
  }

  /** Maps DOMException names to a status the UI can explain without guessing. */
  private classify(error: unknown): CameraOpenResult {
    const name = (error as DOMException)?.name ?? '';
    const message = (error as Error)?.message ?? String(error);
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return {
          status: 'denied',
          stream: null,
          error: 'Camera permission was denied. Allow it in the browser address bar, then retry.',
        };
      case 'NotFoundError':
      case 'OverconstrainedError':
        return { status: 'unavailable', stream: null, error: 'No camera found on this machine.' };
      case 'NotReadableError':
      case 'AbortError':
        return {
          status: 'in-use',
          stream: null,
          error: 'The camera is busy — another app is probably using it.',
        };
      default:
        return { status: 'error', stream: null, error: message };
    }
  }
}
