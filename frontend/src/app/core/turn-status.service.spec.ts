import { TurnStatusService, TURN_SLOW_MS, TURN_TIMEOUT_WS_MS } from './turn-status.service';

describe('TurnStatusService', () => {
  beforeEach(() => {
    jasmine.clock().install();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('begins a turn and marks slow after threshold', () => {
    const zone = { run: (fn: () => void) => fn() } as never;
    const service = new TurnStatusService(zone);
    service.beginTurn('req-1', 'conv-1', 'Sending…');
    expect(service.snapshot?.message).toBe('Sending…');
    jasmine.clock().tick(TURN_SLOW_MS + 1);
    expect(service.snapshot?.slow).toBe(true);
    expect(service.snapshot?.message).toContain('longer than usual');
  });

  it('emits timeout and marks terminal retryable state', () => {
    const zone = { run: (fn: () => void) => fn() } as never;
    const service = new TurnStatusService(zone);
    const timeouts: Array<{ requestId: string; message: string }> = [];
    service.timeout$.subscribe((event) => {
      if (event) {
        timeouts.push({ requestId: event.requestId, message: event.message });
      }
    });
    service.beginTurn('req-2', 'conv-1');
    jasmine.clock().tick(TURN_TIMEOUT_WS_MS + 1);
    expect(timeouts.length).toBe(1);
    expect(service.snapshot?.retryable).toBe(true);
    expect(service.snapshot?.isTerminal).toBe(true);
  });

  it('clears active turn on completeTurn', () => {
    const zone = { run: (fn: () => void) => fn() } as never;
    const service = new TurnStatusService(zone);
    service.beginTurn('req-3', 'conv-1');
    service.completeTurn('req-3');
    expect(service.snapshot).toBeNull();
  });
});
