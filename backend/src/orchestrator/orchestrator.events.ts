import { ConfirmationRequest } from '../guardrails/guardrail.service';
import { PermissionRequest } from '../permissions/permission.types';

export interface ProgressEvent {
  stage: string;
  message: string;
  percent?: number;
  detail?: string;
  toolName?: string;
}

export interface OrchestratorEmitter {
  onToken(token: string): void;
  onThinking?(token: string): void;
  onProgress?(event: ProgressEvent): void;
  onToolStart(toolName: string, args: Record<string, unknown>): void;
  onToolEnd(toolName: string, output: string, success: boolean): void;
  onConfirmationRequest(request: ConfirmationRequest): void;
  onPermissionRequest(request: PermissionRequest): void;
  onDone(finalText: string): void;
  onError(message: string): void;
}
