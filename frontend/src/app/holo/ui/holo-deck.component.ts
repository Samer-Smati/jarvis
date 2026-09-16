import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { HoloSessionService } from '../state/holo-session.service';
import { drawHandFrame } from './hand-overlay.renderer';

/**
 * Phase 1 surface: camera preview, tracked-skeleton overlay, diagnostics.
 *
 * Deliberately thin — it starts/stops a session and paints frames. No landmark
 * maths, no gesture logic, no data access lives here.
 */
@Component({
  selector: 'app-holo-deck',
  standalone: false,
  templateUrl: './holo-deck.component.html',
  styleUrl: './holo-deck.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HoloDeckComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') private videoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('overlay') private overlayRef?: ElementRef<HTMLCanvasElement>;

  readonly session = inject(HoloSessionService);
  private readonly zone = inject(NgZone);

  readonly showDebug = signal(true);
  readonly busy = signal(false);

  private rafId = 0;
  private ctx: CanvasRenderingContext2D | null = null;
  private readonly onResize = () => this.sizeCanvas();

  ngAfterViewInit(): void {
    this.ctx = this.overlayRef?.nativeElement.getContext('2d') ?? null;
    this.sizeCanvas();
    window.addEventListener('resize', this.onResize);
    this.startRenderLoop();
  }

  ngOnDestroy(): void {
    // Leaving the route must release the camera; otherwise the light stays on.
    window.removeEventListener('resize', this.onResize);
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.session.dispose(this.videoRef?.nativeElement);
  }

  async toggle(): Promise<void> {
    if (this.busy()) {
      return;
    }
    const video = this.videoRef?.nativeElement;
    if (!video) {
      return;
    }
    this.busy.set(true);
    try {
      if (this.session.isActive()) {
        this.session.stop(video);
      } else {
        await this.session.start(video);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** Paints the newest frame every animation frame, outside Angular. */
  private startRenderLoop(): void {
    this.zone.runOutsideAngular(() => {
      const tick = () => {
        this.rafId = requestAnimationFrame(tick);
        const canvas = this.overlayRef?.nativeElement;
        if (!this.ctx || !canvas) {
          return;
        }
        drawHandFrame(this.ctx, this.session.latestFrame, canvas.width, canvas.height);
      };
      this.rafId = requestAnimationFrame(tick);
    });
  }

  /** A canvas is a replaced element: CSS size alone leaves the buffer at 300×150. */
  private sizeCanvas(): void {
    const canvas = this.overlayRef?.nativeElement;
    if (!canvas) {
      return;
    }
    canvas.width = canvas.clientWidth || window.innerWidth;
    canvas.height = canvas.clientHeight || window.innerHeight;
  }
}
