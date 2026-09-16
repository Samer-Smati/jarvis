/** Rolling FPS over a fixed window. Pure and allocation-free after warm-up. */
export class FpsMeter {
  private readonly samples: number[] = [];
  private lastTimestamp: number | null = null;

  constructor(private readonly window: number) {}

  /** Feed each frame's timestamp; returns the current rolling average. */
  sample(timestampMs: number): number {
    if (this.lastTimestamp !== null) {
      const delta = timestampMs - this.lastTimestamp;
      if (delta > 0) {
        this.samples.push(1000 / delta);
        if (this.samples.length > this.window) {
          this.samples.shift();
        }
      }
    }
    this.lastTimestamp = timestampMs;
    return this.value;
  }

  get value(): number {
    if (!this.samples.length) {
      return 0;
    }
    const total = this.samples.reduce((sum, v) => sum + v, 0);
    return Math.round(total / this.samples.length);
  }

  reset(): void {
    this.samples.length = 0;
    this.lastTimestamp = null;
  }
}
