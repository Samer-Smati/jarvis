import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { VoiceService } from '../../core/voice.service';
import { HoloApiService, type HoloSource } from '../api/holo-api.service';
import { GestureEngine } from '../gestures/gesture-engine';
import { GestureKind, IDLE_TWO_HAND, primaryGesture, type GestureFrame } from '../gestures/gesture.types';
import { HOLO_CONFIG, type HoloConfig } from '../holo.config';
import { PointerInput, type PointerCommand } from '../input/pointer-input';
import { SceneEngine } from '../scene/scene-engine';
import type { SceneEvent } from '../scene/scene.types';
import { HoloSessionService } from '../state/holo-session.service';
import { HoloWorkspaceService } from '../state/holo-workspace.service';
import { drawHandFrame } from './hand-overlay.renderer';
import { ThreeSceneRenderer } from './three-scene.renderer';

/** How often live telemetry is pushed into Angular. Matches the tracking layer's
 *  own publish rate — a debug panel refreshing at display rate is unreadable
 *  anyway, and every update costs change detection. */
const TELEMETRY_INTERVAL_MS = 100;

/** Events worth a spoken acknowledgement. Dragging and hovering are deliberately
 *  absent: JARVIS narrating every movement is exhausting. */
const SPOKEN: Partial<Record<SceneEvent['kind'], (card?: string) => string>> = {
  'card-focus': (card) => (card ? `${card}, sir.` : 'Opened, sir.'),
  'orb-open': (card) => (card ? `${card} expanded, sir.` : 'Expanded, sir.'),
  organize: () => 'Workspace organised, sir.',
  reset: () => 'Workspace restored, sir.',
};

/** Floor between two spoken acknowledgements, whatever the events. */
const SPEECH_COOLDOWN_MS = 4000;

/**
 * The H.O.L.O. deck: camera, skeleton overlay, and a 3D workspace of real JARVIS
 * entities that hands or a mouse can manipulate.
 *
 * Deliberately thin. It owns the loop and the seams between the engines; what a
 * pose *is* lives in GestureEngine, what a gesture *means* lives in SceneEngine,
 * and what an entity *is* lives in the adapter. The pointer fallback synthesizes
 * the same gesture frames the hands do, so there is exactly one interaction path.
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
  @ViewChild('stage') private stageRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('shell') private shellRef?: ElementRef<HTMLElement>;

  readonly session = inject(HoloSessionService);
  private readonly api = inject(HoloApiService);
  private readonly workspace = inject(HoloWorkspaceService);
  private readonly voice = inject(VoiceService);
  private readonly zone = inject(NgZone);

  /** A working copy: the effects panel mutates it, and both engines are told. */
  private config: HoloConfig = structuredClone(inject(HOLO_CONFIG));

  private readonly gestures = new GestureEngine(this.config);
  private readonly scene = new SceneEngine(this.config);
  private readonly pointer = new PointerInput(this.config, (command) => this.onPointerCommand(command));
  private renderer: ThreeSceneRenderer | null = null;

  readonly showDebug = signal(false);
  readonly busy = signal(false);
  readonly source = signal<HoloSource>('brain');
  readonly deckSize = signal(0);
  readonly loading = signal(false);
  readonly lastEvent = signal<string | null>(null);
  readonly usingPointer = signal(false);

  // Effects, surfaced for the control panel.
  readonly effectsEnabled = signal(true);
  readonly proximityEnabled = signal(true);
  readonly physicsEnabled = signal(true);
  readonly cameraIntensity = signal(0.55);
  readonly glowIntensity = signal(0.7);

  // Telemetry for the debug panel, published at 10Hz.
  readonly gesture = signal<string>('none');
  readonly gestureConfidence = signal(0);
  readonly pinchDistance = signal(0);
  readonly handVelocity = signal(0);
  readonly twoHandDistance = signal(0);
  readonly zoom = signal(1);
  readonly hovered = signal<string | null>(null);
  readonly selected = signal<string | null>(null);
  readonly layout = signal<'ring' | 'grid'>('ring');

  readonly focusTitle = signal<string | null>(null);
  readonly focusBody = signal<string | null>(null);
  readonly hasFocus = computed(() => this.focusTitle() !== null);
  readonly camStyle = computed(() => ({ opacity: this.session.isActive() ? this.cameraIntensity() : 0 }));

  readonly sources: HoloSource[] = ['brain', 'projects', 'tasks', 'memories', 'events', 'calendar', 'all'];

  private rafId = 0;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastFrameAt = 0;
  private lastRenderedTimestamp = -1;
  private lastTelemetryAt = 0;
  private lastSpokeAt = 0;
  private readonly lastReportAt = new Map<string, number>();
  private readonly subs = new Subscription();
  private detachPointer: (() => void) | null = null;
  private readonly onResize = () => this.sizeSurfaces();

  ngAfterViewInit(): void {
    this.ctx = this.overlayRef?.nativeElement.getContext('2d') ?? null;
    const stage = this.stageRef?.nativeElement;
    if (stage) {
      this.renderer = new ThreeSceneRenderer(stage, this.config);
    }
    const shell = this.shellRef?.nativeElement;
    if (shell) {
      // The deck must be reachable without a webcam, so pointer input is always
      // attached — hands are an additional device, never the only one.
      this.detachPointer = this.pointer.attach(shell);
      shell.tabIndex = 0;
    }

    this.sizeSurfaces();
    window.addEventListener('resize', this.onResize);

    this.subs.add(
      this.workspace.command$.subscribe((command) => {
        if (command.kind === 'SHOW_WORKSPACE' && command.source) {
          this.load(command.source);
        } else if (command.kind === 'ORGANIZE_WORKSPACE') {
          this.applyEvents(this.scene.organize());
        } else if (command.kind === 'RESET_WORKSPACE') {
          this.applyEvents(this.scene.reset());
        }
      }),
    );

    // A command issued from chat before navigating here must not be lost.
    const pending = this.workspace.takePending();
    this.load(pending?.source ?? 'brain');
    this.startRenderLoop();
  }

  ngOnDestroy(): void {
    // Leaving the route must release the camera, the GL context, every DOM
    // listener and the frame loop. Anything missed here survives the route and
    // keeps costing frames for the rest of the session.
    window.removeEventListener('resize', this.onResize);
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.subs.unsubscribe();
    this.detachPointer?.();
    this.detachPointer = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.session.dispose(this.videoRef?.nativeElement);
  }

  // ----------------------------------------------------------------- controls

  async toggleHands(): Promise<void> {
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
        // A returning hand must not resume a half-finished gesture, and nothing
        // may stay held by a hand that is no longer being tracked.
        this.gestures.reset();
        this.applyEvents(this.scene.reset());
      } else {
        await this.session.start(video);
      }
    } finally {
      this.busy.set(false);
    }
  }

  load(source: HoloSource): void {
    this.source.set(source);
    this.loading.set(true);
    this.subs.add(
      this.api.workspace(source).subscribe((groups) => {
        this.scene.load(groups);
        this.deckSize.set(groups.length);
        this.loading.set(false);
      }),
    );
  }

  organize(): void {
    this.applyEvents(this.scene.organize());
  }

  reset(): void {
    this.applyEvents(this.scene.reset());
  }

  toggleEffects(): void {
    this.effectsEnabled.set(!this.effectsEnabled());
    this.applyConfig();
  }

  toggleProximity(): void {
    this.proximityEnabled.set(!this.proximityEnabled());
    this.applyConfig();
  }

  togglePhysics(): void {
    this.physicsEnabled.set(!this.physicsEnabled());
    this.applyConfig();
  }

  /** The CAM control: how strongly the camera feed shows through the scene. */
  cycleCamera(): void {
    const steps = [0.15, 0.55, 0.8];
    const next = steps[(steps.indexOf(this.cameraIntensity()) + 1) % steps.length] ?? 0.55;
    this.cameraIntensity.set(next);
    this.applyConfig();
  }

  private applyConfig(): void {
    this.config = {
      ...this.config,
      effects: {
        ...this.config.effects,
        effectsEnabled: this.effectsEnabled(),
        proximityEnabled: this.proximityEnabled(),
        physicsEnabled: this.physicsEnabled(),
        cameraIntensity: this.cameraIntensity(),
        glowIntensity: this.glowIntensity(),
      },
    };
    this.scene.configure(this.config);
    this.renderer?.configure(this.config);
  }

  private onPointerCommand(command: PointerCommand): void {
    switch (command.kind) {
      case 'zoom':
        this.scene.zoomBy(command.factor);
        break;
      case 'pan':
        this.scene.panBy(command.x, command.y);
        break;
      case 'rotate':
        this.scene.rotateBy(command.radians);
        break;
      case 'organize':
        this.applyEvents(this.scene.organize());
        break;
      case 'reset':
        this.applyEvents(this.scene.reset());
        break;
      case 'collapse':
        this.applyEvents(this.scene.collapse());
        break;
      case 'toggle-effects':
        this.zone.run(() => this.toggleEffects());
        break;
      case 'toggle-debug':
        this.zone.run(() => this.showDebug.set(!this.showDebug()));
        break;
    }
  }

  // --------------------------------------------------------------------- loop

  /**
   * One loop, outside Angular: gestures from the newest frame, scene from the
   * gestures, pixels from the scene. Signals are touched only when a scene event
   * fires or the telemetry window elapses, so a still hand costs no change
   * detection at all.
   */
  private startRenderLoop(): void {
    this.zone.runOutsideAngular(() => {
      const tick = (now: number) => {
        this.rafId = requestAnimationFrame(tick);

        const dt = this.lastFrameAt === 0 ? 16 : now - this.lastFrameAt;
        this.lastFrameAt = now;

        const frame = this.session.latestFrame;
        const handsLive = this.session.isActive();
        let gestureFrame: GestureFrame | null = null;

        // The detector runs per video frame, slower than rAF. Re-running the
        // gesture engine on a repeated frame would double-count its debounce
        // windows and fire a tap twice.
        if (handsLive && frame.timestamp !== this.lastRenderedTimestamp) {
          this.lastRenderedTimestamp = frame.timestamp;
          gestureFrame = this.gestures.update(frame);
        } else if (!handsLive && this.pointer.engaged) {
          gestureFrame = this.pointer.frame(now);
        }

        if (gestureFrame) {
          const events = this.scene.update(gestureFrame, dt);
          if (events.length) {
            this.applyEvents(events);
          }
        } else {
          // No new input this frame. Advance easing, proximity and throws, but
          // do not let an absent frame be read as the hands having left.
          this.scene.advance(dt);
        }

        this.renderer?.render(this.scene.state);

        const canvas = this.overlayRef?.nativeElement;
        if (this.ctx && canvas) {
          drawHandFrame(this.ctx, handsLive ? frame : { hands: [], timestamp: now }, canvas.width, canvas.height);
        }

        if (now - this.lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
          this.lastTelemetryAt = now;
          this.publishTelemetry(
            gestureFrame ?? { hands: [], twoHand: IDLE_TWO_HAND, flicks: [], peace: false, timestamp: now },
            handsLive,
          );
        }
      };
      this.rafId = requestAnimationFrame(tick);
    });
  }

  private publishTelemetry(frame: GestureFrame, handsLive: boolean): void {
    const primary = primaryGesture(frame);
    const state = this.scene.state;
    const hoverLabel = state.objects.find((o) => o.id === state.hoverId)?.label ?? null;
    const selectedLabel = state.objects.find((o) => o.id === state.selectedId)?.label ?? null;
    const velocity = primary ? Math.hypot(primary.velocity.x, primary.velocity.y) : 0;

    this.zone.run(() => {
      this.gesture.set(primary?.kind ?? GestureKind.NONE);
      this.gestureConfidence.set(primary ? Math.round(primary.confidence * 100) / 100 : 0);
      this.pinchDistance.set(primary ? Math.round(primary.pinchDistance * 1000) / 1000 : 0);
      this.handVelocity.set(Math.round(velocity * 100) / 100);
      this.twoHandDistance.set(Math.round(frame.twoHand.distance * 1000) / 1000);
      this.zoom.set(Math.round(state.camera.zoom * 100) / 100);
      this.hovered.set(hoverLabel);
      this.selected.set(selectedLabel);
      this.layout.set(state.layout);
      this.usingPointer.set(!handsLive && this.pointer.engaged);
    });
  }

  /** Scene events are the only thing that crosses back into Angular. */
  private applyEvents(events: SceneEvent[]): void {
    if (!events.length) {
      return;
    }
    for (const event of events) {
      this.report(event);
    }

    const state = this.scene.state;
    const focused = state.focusId ? state.objects.find((o) => o.id === state.focusId) : null;
    const title = focused?.label ?? null;
    const body = focused?.body ?? null;
    const last = events[events.length - 1];

    this.speak(events);

    this.zone.run(() => {
      this.focusTitle.set(title);
      this.focusBody.set(body);
      this.layout.set(state.layout);
      this.lastEvent.set(last ? `${last.kind}${last.card ? ` · ${last.card}` : ''}` : null);
    });
  }

  /** Only meaningful actions get a spoken acknowledgement, and never two in
   *  quick succession — a fast sequence of opens must not queue four sentences. */
  private speak(events: SceneEvent[]): void {
    const now = performance.now();
    if (now - this.lastSpokeAt < SPEECH_COOLDOWN_MS) {
      return;
    }
    for (const event of events) {
      const phrase = SPOKEN[event.kind];
      if (phrase) {
        this.lastSpokeAt = now;
        void this.voice.speakAsJarvis(phrase(event.card)).catch(() => undefined);
        return;
      }
    }
  }

  /** Throttled per event kind — a drag releases as often as the user moves, and
   *  the episodic log should not carry every one of them. */
  private report(event: SceneEvent): void {
    const now = performance.now();
    const previous = this.lastReportAt.get(event.kind) ?? -Infinity;
    if (now - previous < this.config.scene.reportThrottleMs) {
      return;
    }
    this.lastReportAt.set(event.kind, now);
    this.api.report(event.kind, event.card);
  }

  /** Canvases are replaced elements: CSS size alone leaves the buffer at 300×150. */
  private sizeSurfaces(): void {
    const canvas = this.overlayRef?.nativeElement;
    if (canvas) {
      canvas.width = canvas.clientWidth || window.innerWidth;
      canvas.height = canvas.clientHeight || window.innerHeight;
    }
    this.renderer?.resize();
  }
}
