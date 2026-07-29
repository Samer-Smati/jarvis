import { toolStatusLabel } from '../orchestrator/tool-status-label.util';
import { emitTurnStatus } from '../orchestrator/orchestrator.events';
import type { OrchestratorEmitter } from '../orchestrator/orchestrator.events';

describe('turn status wire helpers', () => {
  it('emitTurnStatus forwards to progress and turn_status handlers', () => {
    const progress: unknown[] = [];
    const turnStatus: unknown[] = [];
    const emitter: OrchestratorEmitter = {
      onToken: () => undefined,
      onProgress: (event) => progress.push(event),
      onTurnStatus: (event) => turnStatus.push(event),
      onToolStart: () => undefined,
      onToolEnd: () => undefined,
      onConfirmationRequest: () => undefined,
      onPermissionRequest: () => undefined,
      onDone: () => undefined,
      onError: () => undefined,
    };
    emitTurnStatus(emitter, { stage: 'thinking', message: 'Thinking…' });
    expect(progress).toHaveLength(1);
    expect(turnStatus).toHaveLength(1);
  });

  it('labels generic tools for status messages', () => {
    expect(toolStatusLabel('web_search')).toContain('web');
  });
});
