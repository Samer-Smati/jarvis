import { FpsMeter } from './fps-meter';

describe('FpsMeter', () => {
  it('reports zero before it has two samples', () => {
    const meter = new FpsMeter(30);
    expect(meter.value).toBe(0);
    meter.sample(0);
    expect(meter.value).toBe(0);
  });

  it('computes fps from frame spacing', () => {
    const meter = new FpsMeter(30);
    for (let i = 0; i < 10; i++) {
      meter.sample(i * 33.333);
    }
    expect(meter.value).toBe(30);
  });

  it('ignores non-advancing timestamps instead of dividing by zero', () => {
    const meter = new FpsMeter(30);
    meter.sample(100);
    meter.sample(100);
    expect(Number.isFinite(meter.value)).toBe(true);
  });

  it('only averages over its window', () => {
    const meter = new FpsMeter(3);
    for (let i = 0; i < 5; i++) {
      meter.sample(i * 100); // 10fps
    }
    for (let i = 0; i < 3; i++) {
      meter.sample(500 + i * 10); // 100fps
    }
    expect(meter.value).toBeGreaterThan(50);
  });

  it('resets cleanly', () => {
    const meter = new FpsMeter(30);
    meter.sample(0);
    meter.sample(33);
    meter.reset();
    expect(meter.value).toBe(0);
  });
});
