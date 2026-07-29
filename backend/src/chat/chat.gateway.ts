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
import { OrchestratorEmitter, TurnStatusEvent } from '../orchestrator/orchestrator.events';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { PermissionsService } from '../permissions/permissions.service';
import type { ChatImagePart } from '../llm/llm.types';
import { resolveChatRequestId } from './chat-request.util';
import { assertValidConversationId } from './conversation-id.util';

interface UserMessagePayload {
  conversationId: string;
  requestId?: string;
  text: string;
  platform?: 'desktop' | 'web';
  history?: Array<{ role: string; content: string; createdAt?: string }>;
  images?: ChatImagePart[];
}

interface ConfirmationResponsePayload {
  id: string;
  approved: boolean;
}

const HEARTBEAT_MS = 2500;

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
    const conversationIdRaw = payload?.conversationId;
    let conversationId: string;
    try {
      conversationId = assertValidConversationId(conversationIdRaw);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid conversationId.';
      client.emit('agent_error', {
        conversationId: conversationIdRaw ?? '',
        message,
        retryable: false,
      });
      return;
    }
    const requestId = resolveChatRequestId(payload?.requestId);
    const text = payload?.text?.trim() ?? '';
    const images = payload?.images?.slice(0, 4);
    if (!text && !images?.length) {
      return;
    }
    this.logger.log(`[${conversationId}] user: ${text.slice(0, 80)}${images?.length ? ` (+${images.length} img)` : ''}`);
    const turnStarted = Date.now();
    const emitter = this.buildEmitter(conversationId, requestId, client, turnStarted);
    client.emit('started', { conversationId, requestId, ts: turnStarted });
    const heartbeat = setInterval(() => {
      client.emit('heartbeat', {
        conversationId,
        requestId,
        ts: Date.now(),
        elapsedMs: Date.now() - turnStarted,
      });
    }, HEARTBEAT_MS);
    let streamFinished = false;
    const finish = () => {
      streamFinished = true;
      clearInterval(heartbeat);
    };
    try {
      await this.orchestrator.handleUserMessage(
        conversationId,
        text,
        {
          ...emitter,
          onDone: (finalText, meta) => {
            finish();
            emitter.onDone(finalText, meta);
          },
          onError: (message, meta) => {
            finish();
            emitter.onError(message, meta);
          },
        },
        'chat',
        payload?.platform === 'web' ? 'web' : 'desktop',
        payload?.history,
        images?.length ? images : undefined,
        requestId,
      );
    } catch (error) {
      if (!streamFinished) {
        finish();
        const message = error instanceof Error ? error.message : 'Unexpected server error.';
        client.emit('agent_error', {
          conversationId,
          requestId,
          message,
          retryable: true,
        });
      }
    } finally {
      if (!streamFinished) {
        finish();
      }
    }
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

  private buildEmitter(
    conversationId: string,
    requestId: string,
    client: Socket,
    turnStarted: number,
  ): OrchestratorEmitter {
    const emitStatus = (event: string, data: Record<string, unknown>) =>
      client.emit(event, { conversationId, requestId, ...data });
    const emitTurn = (event: TurnStatusEvent) => {
      const payload = { ...event, elapsedMs: Date.now() - turnStarted };
      emitStatus('progress', payload);
      emitStatus('turn_status', payload);
    };
    return {
      onToken: (token) => emitStatus('token', { token }),
      onThinking: (token) => emitStatus('thinking', { token }),
      onProgress: (event) => emitTurn(event),
      onTurnStatus: (event) => emitTurn(event),
      onToolStart: (toolName, args) => emitStatus('tool_start', { toolName, args }),
      onToolEnd: (toolName, output, success) => emitStatus('tool_end', { toolName, output, success }),
      onConfirmationRequest: (request) => emitStatus('confirmation_request', { request }),
      onPermissionRequest: (request) => emitStatus('permission_request', { request }),
      onDone: (finalText, meta) => emitStatus('done', { finalText, ...meta }),
      onError: (message, meta) =>
        emitStatus('agent_error', { message, retryable: meta?.retryable ?? true }),
    };
  }
}
