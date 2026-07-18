import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GuardrailService } from '../guardrails/guardrail.service';
import { OrchestratorEmitter } from '../orchestrator/orchestrator.events';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { PermissionsService } from '../permissions/permissions.service';

interface UserMessagePayload {
  conversationId: string;
  text: string;
  platform?: 'desktop' | 'web';
}

interface ConfirmationResponsePayload {
  id: string;
  approved: boolean;
}

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN ?? ['http://localhost:4200', 'http://localhost:3847', 'http://127.0.0.1:3847'],
  },
})
export class ChatGateway {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly guardrails: GuardrailService,
    private readonly permissions: PermissionsService,
  ) {}

  @SubscribeMessage('user_message')
  async onUserMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: UserMessagePayload,
  ): Promise<void> {
    const conversationId = payload?.conversationId ?? 'default';
    const text = payload?.text?.trim();
    if (!text) {
      return;
    }
    this.logger.log(`[${conversationId}] user: ${text.slice(0, 80)}`);
    // Scope run events to the requesting client so other open tabs
    // don't also render/speak the response (double-voice bug).
    const emitter = this.buildEmitter(conversationId, client);
    void this.orchestrator.handleUserMessage(
      conversationId,
      text,
      emitter,
      'chat',
      payload?.platform === 'web' ? 'web' : 'desktop',
    );
  }

  @SubscribeMessage('permission_response')
  onPermissionResponse(
    @MessageBody() payload: { id: string; approved: boolean; platform?: string },
  ): void {
    void this.permissions.resolveRequest(
      payload?.id,
      !!payload?.approved,
      payload?.platform === 'web' ? 'web' : 'desktop',
    );
  }

  @SubscribeMessage('confirmation_response')
  onConfirmationResponse(@MessageBody() payload: ConfirmationResponsePayload): void {
    this.guardrails.resolveConfirmation(payload?.id, !!payload?.approved);
  }

  notifyReminderFired(reminder: { id: string; text: string; dueAt: Date }): void {
    this.server?.emit('reminder_fired', reminder);
  }

  notifyMorningBriefing(text: string): void {
    this.server?.emit('morning_briefing', { text });
  }

  private buildEmitter(conversationId: string, client: Socket): OrchestratorEmitter {
    const emit = (event: string, data: Record<string, unknown>) =>
      client.emit(event, { conversationId, ...data });
    return {
      onToken: (token) => emit('token', { token }),
      onToolStart: (toolName, args) => emit('tool_start', { toolName, args }),
      onToolEnd: (toolName, output, success) => emit('tool_end', { toolName, output, success }),
      onConfirmationRequest: (request) => emit('confirmation_request', { request }),
      onPermissionRequest: (request) => emit('permission_request', { request }),
      onDone: (finalText) => emit('done', { finalText }),
      onError: (message) => emit('agent_error', { message }),
    };
  }
}
