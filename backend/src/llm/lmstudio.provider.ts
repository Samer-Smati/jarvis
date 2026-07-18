import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatMessage,
  LlmChatOptions,
  LlmChatResult,
  LlmProvider,
  ToolCall,
} from './llm.types';
import { describeLlmNetworkError } from './llm-network-error';

interface OpenAiMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
}

interface StreamToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      // LM Studio separates model reasoning when "parse reasoning" is enabled.
      reasoning_content?: string | null;
      tool_calls?: StreamToolCallDelta[];
    };
  }[];
}

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/** Remove <think>...</think> reasoning blocks (an unclosed block hides the rest). */
function stripThink(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const open = raw.indexOf(THINK_OPEN, i);
    if (open === -1) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, open);
    const close = raw.indexOf(THINK_CLOSE, open);
    if (close === -1) {
      return out;
    }
    i = close + THINK_CLOSE.length;
  }
  return out;
}

/** Trailing chars that might be the start of a split '<think>' tag — hold them back. */
function holdbackLength(visible: string): number {
  for (let k = Math.min(THINK_OPEN.length - 1, visible.length); k > 0; k--) {
    if (THINK_OPEN.startsWith(visible.slice(-k))) {
      return k;
    }
  }
  return 0;
}

/**
 * LM Studio provider, using its OpenAI-compatible /v1/chat/completions endpoint
 * (streaming + custom tools). Default server: http://localhost:1234/v1.
 */
@Injectable()
export class LmStudioProvider implements LlmProvider {
  readonly name = 'lmstudio';
  private readonly logger = new Logger(LmStudioProvider.name);
  private readonly baseUrl: string;
  private configuredModel: string;
  private detectedModel?: string;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('LMSTUDIO_BASE_URL') ?? 'http://localhost:1234/v1').replace(/\/$/, '');
    this.configuredModel = config.get<string>('LMSTUDIO_CHAT_MODEL') ?? '';
  }

  setPreferredModel(model: string): void {
    if (model?.trim()) {
      this.configuredModel = model.trim();
      this.detectedModel = undefined;
    }
  }

  async isReady(): Promise<{ ok: boolean; model?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) {
        return { ok: false, error: `LM Studio returned ${response.status}` };
      }
      const data = (await response.json()) as { data?: { id: string }[] };
      const chat = data.data?.find((m) => !m.id.toLowerCase().includes('embed'));
      if (!chat) {
        return { ok: false, error: 'No chat model loaded. Run: lms load qwen/qwen3.5-9b' };
      }
      return { ok: true, model: this.configuredModel || chat.id };
    } catch (error) {
      return {
        ok: false,
        error: describeLlmNetworkError(
          error,
          'LM Studio',
          'Open LM Studio, start the local server, and load a chat model (e.g. lms server start && lms load qwen/qwen3.5-9b).',
        ),
      };
    }
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    const model = await this.resolveModel();
    const body = {
      model,
      stream: true,
      messages: options.messages.map((m) => this.toOpenAiMessage(m)),
      tools: options.tools?.length
        ? options.tools.map((t) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined,
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal ?? null,
      });
    } catch (error) {
      throw new Error(
        describeLlmNetworkError(
          error,
          'LM Studio',
          'Open LM Studio, start the local server, and load a chat model (e.g. lms server start && lms load qwen/qwen3.5-9b).',
        ),
      );
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`LM Studio request failed (${response.status}): ${text}`);
    }

    let raw = '';
    let reasoningRaw = '';
    let emitted = 0;
    const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') {
          continue;
        }
        const chunk = JSON.parse(data) as StreamChunk;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          continue;
        }
        if (delta.reasoning_content) {
          reasoningRaw += delta.reasoning_content;
        }
        if (delta.content) {
          raw += delta.content;
          const visible = stripThink(raw);
          const safeEnd = visible.length - holdbackLength(visible);
          if (safeEnd > emitted) {
            options.onToken?.(visible.slice(emitted, safeEnd));
            emitted = safeEnd;
          }
        }
        for (const call of delta.tool_calls ?? []) {
          const entry = pendingCalls.get(call.index) ?? { id: '', name: '', args: '' };
          if (call.id) {
            entry.id = call.id;
          }
          if (call.function?.name) {
            entry.name += call.function.name;
          }
          if (call.function?.arguments) {
            entry.args += call.function.arguments;
          }
          pendingCalls.set(call.index, entry);
        }
      }
    }

    const toolCalls: ToolCall[] = [...pendingCalls.values()]
      .filter((c) => c.name)
      .map((c, i) => ({
        id: c.id || `call_${i}_${Date.now()}`,
        name: c.name,
        arguments: this.parseArgs(c.args),
      }));

    // Reasoning models (e.g. qwen) inline <think> blocks; never surface them.
    let content = stripThink(raw).trim();
    if (!content && !pendingCalls.size) {
      // The whole reply ended up inside reasoning (unclosed think block or
      // separated reasoning_content) — salvage its tail rather than staying silent.
      const inner = (raw || reasoningRaw).replace(/<\/?think>/g, '').trim();
      if (inner) {
        const paragraphs = inner.split(/\n{2,}/);
        content = paragraphs[paragraphs.length - 1].trim();
      }
    }
    if (content.length > emitted) {
      options.onToken?.(content.slice(emitted));
    }

    this.logger.debug(`chat done: ${content.length} chars, ${toolCalls.length} tool calls`);
    return { content, toolCalls };
  }

  /** Use the configured model, or auto-detect the first model loaded in LM Studio. */
  private async resolveModel(): Promise<string> {
    if (this.configuredModel) {
      return this.configuredModel;
    }
    if (this.detectedModel) {
      return this.detectedModel;
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/models`);
    } catch (error) {
      throw new Error(
        describeLlmNetworkError(
          error,
          'LM Studio',
          'Open LM Studio, start the local server, and load a chat model (e.g. lms server start && lms load qwen/qwen3.5-9b).',
        ),
      );
    }
    if (!response.ok) {
      throw new Error(`Could not list LM Studio models (${response.status}). Is the LM Studio server running?`);
    }
    const data = (await response.json()) as { data?: { id: string }[] };
    const first = data.data?.find((m) => !m.id.toLowerCase().includes('embed'))?.id;
    if (!first) {
      throw new Error('No chat model is loaded in LM Studio. Load one in the LM Studio app first.');
    }
    this.detectedModel = first;
    this.logger.log(`Auto-detected LM Studio model: ${first}`);
    return first;
  }

  private parseArgs(raw: string): Record<string, unknown> {
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.logger.warn(`Tool call arguments were not valid JSON: ${raw.slice(0, 120)}`);
      return {};
    }
  }

  private toOpenAiMessage(message: ChatMessage): OpenAiMessage {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId ?? '',
      };
    }
    const result: OpenAiMessage = { role: message.role, content: message.content ?? '' };
    if (message.role === 'assistant' && message.toolCalls?.length) {
      result.tool_calls = message.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      }));
    }
    return result;
  }
}
