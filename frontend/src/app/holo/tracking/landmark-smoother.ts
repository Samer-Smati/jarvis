import type { HoloConfig } from '../holo.config';
import type { Landmark } from '../types/holo.types';

/**
 * One Euro filter (Casiez et al., CHI 2012).
 *
 * Webcam landmarks jitter at rest and lag when smoothed with a fixed low-pass.
 * One Euro adapts its cutoff to speed: it filters hard while the hand is still,
 * and lets fast motion through almost untouched — which is exactly the trade a
 * pointing cursor needs. A plain EMA cannot do both.
 */
class OneEuroScalar {
  private prevValue: number | null = null;
  private prevDerivative = 0;
  private prevTimestampMs: number | null = null;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly derivativeCutoff: number,
  ) {}

  /** Smoothing factor for a given cutoff frequency and sample period. */
  private static alpha(cutoff: number, dtSeconds: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dtSeconds);
  }

  filter(value: number, timestampMs: number): number {
    if (this.prevValue === null || this.prevTimestampMs === null) {
      this.prevValue = value;
      this.prevTimestampMs = timestampMs;
      return value;
    }

    // Guard against duplicate/backwards timestamps, which would divide by zero.
    const dtSeconds = Math.max((timestampMs - this.prevTimestampMs) / 1000, 1e-3);
    this.prevTimestampMs = timestampMs;

    const rawDerivative = (value - this.prevValue) / dtSeconds;
    const dAlpha = OneEuroScalar.alpha(this.derivativeCutoff, dtSeconds);
    const derivative = dAlpha * rawDerivative + (1 - dAlpha) * this.prevDerivative;
    this.prevDerivative = derivative;

    const cutoff = this.minCutoff + this.beta * Math.abs(derivative);
    const alpha = OneEuroScalar.alpha(cutoff, dtSeconds);
    const smoothed = alpha * value + (1 - alpha) * this.prevValue;
    this.prevValue = smoothed;
    return smoothed;
  }

  reset(): void {
    this.prevValue = null;
    this.prevDerivative = 0;
    this.prevTimestampMs = null;
  }
}

/**
 * Smooths a whole hand. One filter triple per landmark, kept per hand slot so a
 * left hand's history never bleeds into the right hand's.
 */
export class HandSmoother {
  private readonly filters = new Map<number, [OneEuroScalar, OneEuroScalar, OneEuroScalar]>();

  constructor(private readonly config: HoloConfig['smoothing']) {}

  private filtersFor(index: number): [OneEuroScalar, OneEuroScalar, OneEuroScalar] {
    let triple = this.filters.get(index);
    if (!triple) {
      const make = () =>
        new OneEuroScalar(this.config.minCutoff, this.config.beta, this.config.derivativeCutoff);
      triple = [make(), make(), make()];
      this.filters.set(index, triple);
    }
    return triple;
  }

  smooth(landmarks: Landmark[], timestampMs: number): Landmark[] {
    return landmarks.map((point, index) => {
      const [fx, fy, fz] = this.filtersFor(index);
      return {
        x: fx.filter(point.x, timestampMs),
        y: fy.filter(point.y, timestampMs),
        z: fz.filter(point.z, timestampMs),
      };
    });
  }

  /** Called when a hand leaves frame so a returning hand does not lerp from a stale pose. */
  reset(): void {
    for (const triple of this.filters.values()) {
      for (const filter of triple) {
        filter.reset();
      }
    }
    this.filters.clear();
  }
}
