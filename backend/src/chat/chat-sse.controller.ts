import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GuardrailService } from '../guardrails/guardrail.service';
import { OrchestratorEmitter } from '../orchestrator/orchestrator.events';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { PermissionsService } from '../permissions/permissions.service';

interface ChatStreamBody {
  conversationId?: string;
  text?: string;
  platform?: 'desktop' | 'web';
}

@Controller('api/chat')
export class ChatSseController {
  private readonly logger = new Logger(ChatSseController.name);

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly guardrails: GuardrailService,
    private readonly permissions: PermissionsService,
  ) {}

  @Post('stream')
  async stream(@Body() body: ChatStreamBody, @Res() res: Response): Promise<void> {
    const conversationId = body?.conversationId ?? 'default';
    const text = body?.text?.trim();
    if (!text) {
      res.status(400).json({ message: 'text is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event: string, data: Record<string, unknown>) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify({ conversationId, ...data })}\n\n`);
    };

    const emitter: OrchestratorEmitter = {
      onToken: (token) => send('token', { token }),
      onToolStart: (toolName, args) => send('tool_start', { toolName, args }),
      onToolEnd: (toolName, output, success) => send('tool_end', { toolName, output, success }),
      onConfirmationRequest: (request) => send('confirmation_request', { request }),
      onPermissionRequest: (request) => send('permission_request', { request }),
      onDone: (finalText) => send('done', { finalText }),
      onError: (message) => send('agent_error', { message }),
    };

    this.logger.log(`[SSE ${conversationId}] user: ${text.slice(0, 80)}`);
    try {
      await this.orchestrator.handleUserMessage(
        conversationId,
        text,
        emitter,
        'chat',
        body?.platform === 'web' ? 'web' : 'desktop',
      );
    } catch (error) {
      send('agent_error', { message: (error as Error).message });
    } finally {
      res.end();
    }
  }

  @Post('confirmation')
  confirm(@Body() body: { id?: string; approved?: boolean }): { ok: boolean } {
    this.guardrails.resolveConfirmation(body?.id ?? '', !!body?.approved);
    return { ok: true };
  }

  @Post('permission')
  permission(@Body() body: { id?: string; approved?: boolean; platform?: string }): { ok: boolean } {
    void this.permissions.resolveRequest(
      body?.id ?? '',
      !!body?.approved,
      body?.platform === 'web' ? 'web' : 'desktop',
    );
    return { ok: true };
  }
}
