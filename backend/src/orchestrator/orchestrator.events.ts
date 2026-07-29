import { ConfirmationRequest } from '../guardrails/guardrail.service';
import { PermissionRequest } from '../permissions/permission.types';

export type TurnStage =
  | 'queued'
  | 'accepted'
  | 'routing'
  | 'thinking'
  | 'tool'
  | 'writing'
  | 'waiting_user'
  | 'done'
  | 'error'
  | 'timeout';

export interface TurnStatusEvent {
  stage: TurnStage | string;
  message: string;
  percent?: number;
  detail?: string;
  toolName?: string;
  elapsedMs?: number;
  slow?: boolean;
  retryable?: boolean;
}

export interface ProgressEvent extends TurnStatusEvent {
  stage: string;
}

export interface OrchestratorEmitter {
  onToken(token: string): void;
  onThinking?(token: string): void;
  onProgress?(event: ProgressEvent): void;
  onTurnStatus?(event: TurnStatusEvent): void;
  onToolStart(toolName: string, args: Record<string, unknown>): void;
  onToolEnd(toolName: string, output: string, success: boolean): void;
  onConfirmationRequest(request: ConfirmationRequest): void;
  onPermissionRequest(request: PermissionRequest): void;
  onDone(finalText: string, meta?: { interactionId?: string; taskRoute?: string; superseded?: boolean }): void;
  onError(message: string, meta?: { retryable?: boolean }): void;
}

export function emitTurnStatus(emitter: OrchestratorEmitter, event: TurnStatusEvent): void {
  emitter.onProgress?.(event as ProgressEvent);
  emitter.onTurnStatus?.(event);
}
