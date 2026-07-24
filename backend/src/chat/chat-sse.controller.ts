import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GuardrailService } from '../guardrails/guardrail.service';
import { OrchestratorEmitter } from '../orchestrator/orchestrator.events';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { PermissionsService } from '../permissions/permissions.service';
import type { ChatImagePart } from '../llm/llm.types';

interface ChatStreamBody {
  conversationId?: string;
  text?: string;
  platform?: 'desktop' | 'web';
  history?: Array<{ role: string; content: string; createdAt?: string }>;
  images?: ChatImagePart[];
}

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 900_000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function sanitizeImages(raw: unknown): ChatImagePart[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ChatImagePart[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const mimeType = String((item as ChatImagePart).mimeType ?? '').toLowerCase();
    const data = String((item as ChatImagePart).data ?? '').replace(/\s/g, '');
    if (!ALLOWED_IMAGE_TYPES.has(mimeType) || !data) {
      continue;
    }
    const approxBytes = Math.ceil((data.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      continue;
    }
    out.push({ mimeType, data });
    if (out.length >= MAX_IMAGES) {
      break;
    }
  }
  return out;
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
    const text = body?.text?.trim() ?? '';
    const images = sanitizeImages(body?.images);
    if (!text && !images.length) {
      res.status(400).json({ message: 'text or images required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: string, data: Record<string, unknown>) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify({ conversationId, ...data })}\n\n`);
      if (typeof (res as Response & { flush?: () => void }).flush === 'function') {
        (res as Response & { flush?: () => void }).flush?.();
      }
    };

    send('started', { ts: Date.now() });
    const heartbeat = setInterval(() => send('heartbeat', { ts: Date.now() }), 2500);
    let streamFinished = false;
    const finish = (event: 'done' | 'agent_error', payload: Record<string, unknown>) => {
      if (streamFinished) {
        return;
      }
      streamFinished = true;
      send(event, payload);
    };

    const emitter: OrchestratorEmitter = {
      onToken: (token) => send('token', { token }),
      onThinking: (token) => send('thinking', { token }),
      onProgress: (event) => send('progress', { ...event }),
      onToolStart: (toolName, args) => send('tool_start', { toolName, args }),
      onToolEnd: (toolName, output, success) => send('tool_end', { toolName, output, success }),
      onConfirmationRequest: (request) => send('confirmation_request', { request }),
      onPermissionRequest: (request) => send('permission_request', { request }),
      onDone: (finalText) => finish('done', { finalText }),
      onError: (message) => finish('agent_error', { message }),
    };

    this.logger.log(`[SSE ${conversationId}] user: ${text.slice(0, 80)}`);
    const run = this.orchestrator.handleUserMessage(
      conversationId,
      text,
      emitter,
      'chat',
      body?.platform === 'web' ? 'web' : 'desktop',
      body?.history,
      images.length ? images : undefined,
    );
    const timeoutMs = process.env.VERCEL ? 290_000 : 120_000;
    try {
      await Promise.race([
        run,
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('SERVERLESS_TIMEOUT')), timeoutMs);
        }),
      ]);
    } catch (error) {
      const message = (error as Error).message;
      if (!streamFinished) {
        if (message === 'SERVERLESS_TIMEOUT') {
          finish('done', {
            finalText:
              'Cloud time limit reached, sir. Say "open PR" if a GitHub branch was updated, or send a shorter follow-up and I will continue.',
          });
        } else {
          finish('agent_error', { message });
        }
      }
    } finally {
      if (!streamFinished) {
        finish('done', {
          finalText: 'Connection closed before I could finish, sir. Please try again.',
        });
      }
      clearInterval(heartbeat);
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
