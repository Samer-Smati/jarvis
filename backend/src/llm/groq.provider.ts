import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatMessage,
  LlmChatOptions,
  LlmChatResult,
  LlmProvider,
  ToolCall,
} from './llm.types';
import { parseTextToolCallsFromContent, ToolMarkupStreamFilter } from './text-tool-call.util';
import {
  cappedRetryAfterMs,
  isModelNotFoundError,
  isRateLimitError,
  sleep,
} from './openai-stream.util';

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

interface StreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }[];
}

/** Groq retired the Llama 3.x free-tier models on 2026-06-17; migrated to their recommended
 * replacements (console.groq.com/docs/deprecations). */
const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_FALLBACK_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b'];

/** Groq — free-tier cloud LLM (OpenAI-compatible). https://console.groq.com */
@Injectable()
export class GroqProvider implements LlmProvider {
  readonly name = 'groq';
  private readonly logger = new Logger(GroqProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallbackModels: string[];
  private readonly baseUrl: string;
  private resolvedModels: string[] | null = null;
  private readyCache: { at: number; value: { ok: boolean; model?: string; error?: string } } | null = null;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GROQ_API_KEY') ?? '';
    this.model = config.get<string>('GROQ_MODEL') ?? DEFAULT_MODEL;
    const configuredFallbacks = config.get<string>('GROQ_FALLBACK_MODELS');
    this.fallbackModels = configuredFallbacks
      ? configuredFallbacks.split(',').map((m) => m.trim()).filter(Boolean)
      : DEFAULT_FALLBACK_MODELS;
    this.baseUrl = (config.get<string>('GROQ_BASE_URL') ?? 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  }

  async isReady(): Promise<{ ok: boolean; model?: string; error?: string }> {
    if (this.readyCache && Date.now() - this.readyCache.at < 60_000) {
      return this.readyCache.value;
    }
    if (!this.apiKey) {
      return { ok: false, error: 'Set GROQ_API_KEY (free at console.groq.com)' };
    }
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        const value = { ok: false as const, error: `Groq returned ${response.status}` };
        this.readyCache = { at: Date.now(), value };
        return value;
      }
      const chain = await this.resolveModelChain();
      if (!chain.length) {
        const value = { ok: false as const, error: 'No supported Groq models available for this API key' };
        this.readyCache = { at: Date.now(), value };
        return value;
      }
      const value = { ok: true as const, model: chain[0] };
      this.readyCache = { at: Date.now(), value };
      return value;
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY is not set. Get a free key at https://console.groq.com');
    }

    const models = await this.resolveModelChain();
    if (!models.length) {
      throw new Error('No Groq models available for your API key. Check console.groq.com');
    }
    let lastError = 'Groq request failed';

    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.chatWithModel(model, options);
        } catch (error) {
          lastError = (error as Error).message;
          if (isModelNotFoundError(lastError)) {
            this.logger.warn(`Groq model unavailable: ${model}`);
            this.resolvedModels = null;
            break;
          }
          const retryMs = cappedRetryAfterMs(lastError);
          if (retryMs != null && attempt < 2) {
            this.logger.warn(`Groq ${model} rate limited — brief wait ${retryMs}ms then retry/rotate`);
            await sleep(retryMs + 200);
            continue;
          }
          if (isRateLimitError(lastError) && model !== models[models.length - 1]) {
            this.logger.warn(`Groq ${model} rate limited — trying fallback model`);
            break;
          }
          if (model !== models[models.length - 1]) {
            this.logger.warn(`Groq ${model} failed: ${lastError}`);
            break;
          }
          throw error;
        }
      }
    }

    throw new Error(lastError);
  }

  private async resolveModelChain(): Promise<string[]> {
    if (this.resolvedModels?.length) {
      return this.resolvedModels;
    }
    const preferred = [this.model, ...this.fallbackModels.filter((m) => m !== this.model)];
    const available = await this.listAvailableModelIds();
    if (!available.size) {
      return preferred;
    }
    const chain = preferred.filter((m) => available.has(m));
    if (!chain.length) {
      for (const fallback of DEFAULT_FALLBACK_MODELS) {
        if (available.has(fallback)) {
          chain.push(fallback);
        }
      }
    }
    if (!chain.length) {
      const first = [...available][0];
      if (first) {
        chain.push(first);
      }
    }
    this.resolvedModels = chain;
    if (chain.length) {
      this.logger.log(`Groq model chain: ${chain.join(' → ')}`);
    }
    return chain;
  }

  private async listAvailableModelIds(): Promise<Set<string>> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        return new Set();
      }
      const payload = (await response.json()) as { data?: Array<{ id?: string }> };
      return new Set((payload.data ?? []).map((m) => m.id).filter(Boolean) as string[]);
    } catch {
      return new Set();
    }
  }

  private async chatWithModel(model: string, options: LlmChatOptions): Promise<LlmChatResult> {
    const body: Record<string, unknown> = {
      model,
      stream: true,
      messages: options.messages.map((m) => this.toOpenAiMessage(m)),
      tools: options.tools?.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    };
    if (options.tools?.length) {
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal ?? null,
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`Groq request failed (${response.status}): ${text}`);
    }

    let content = '';
    const toolCalls: ToolCall[] = [];
    const toolDrafts = new Map<number, { id: string; name: string; args: string }>();
    const markupFilter = new ToolMarkupStreamFilter();
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
        if (!line.startsWith('data:')) {
          continue;
        }
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }
        const chunk = JSON.parse(payload) as StreamChunk;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          continue;
        }
        if (delta.content) {
          content += delta.content;
          markupFilter.feed(delta.content, (safe) => options.onToken?.(safe));
        }
        for (const tc of delta.tool_calls ?? []) {
          const draft = toolDrafts.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) {
            draft.id = tc.id;
          }
          if (tc.function?.name) {
            draft.name = tc.function.name;
          }
          if (tc.function?.arguments) {
            draft.args += tc.function.arguments;
          }
          toolDrafts.set(tc.index, draft);
        }
      }
    }

    for (const draft of toolDrafts.values()) {
      let args: Record<string, unknown> = {};
      try {
        args = draft.args ? (JSON.parse(draft.args) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      toolCalls.push({
        id: draft.id || `call_${toolCalls.length}_${Date.now()}`,
        name: draft.name,
        arguments: args,
      });
    }

    const parsed = parseTextToolCallsFromContent(content);
    content = parsed.content;
    for (const call of parsed.toolCalls) {
      if (!toolCalls.some((t) => t.name === call.name)) {
        toolCalls.push(call);
      }
    }

    this.logger.debug(`chat [${model}] done: ${content.length} chars, ${toolCalls.length} tool calls`);
    return { content, toolCalls };
  }

  private toOpenAiMessage(message: ChatMessage): OpenAiMessage {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId,
      };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
        })),
      };
    }
    return { role: message.role, content: message.content };
  }
}
