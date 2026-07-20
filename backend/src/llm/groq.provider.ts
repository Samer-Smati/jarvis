import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatMessage,
  LlmChatOptions,
  LlmChatResult,
  LlmProvider,
  ToolCall,
} from './llm.types';

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

/** Groq — free-tier cloud LLM (OpenAI-compatible). https://console.groq.com */
@Injectable()
export class GroqProvider implements LlmProvider {
  readonly name = 'groq';
  private readonly logger = new Logger(GroqProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GROQ_API_KEY') ?? '';
    this.model = config.get<string>('GROQ_MODEL') ?? 'openai/gpt-oss-120b';
    this.baseUrl = (config.get<string>('GROQ_BASE_URL') ?? 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  }

  async isReady(): Promise<{ ok: boolean; model?: string; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: 'Set GROQ_API_KEY (free at console.groq.com)' };
    }
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        return { ok: false, error: `Groq returned ${response.status}` };
      }
      return { ok: true, model: this.model };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY is not set. Get a free key at https://console.groq.com');
    }

    const body: Record<string, unknown> = {
      model: this.model,
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
    let suppressToolText = false;
    let toolTextBuffer = '';
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
          if (suppressToolText) {
            toolTextBuffer += delta.content;
            if (toolTextBuffer.includes('</function>')) {
              suppressToolText = false;
              toolTextBuffer = '';
            }
          } else if (delta.content.includes('<function')) {
            const before = delta.content.split('<function')[0];
            if (before) {
              options.onToken?.(before);
            }
            suppressToolText = true;
            toolTextBuffer = delta.content.slice(delta.content.indexOf('<function'));
            if (toolTextBuffer.includes('</function>')) {
              suppressToolText = false;
              toolTextBuffer = '';
            }
          } else {
            options.onToken?.(delta.content);
          }
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

    const parsed = parseTextToolCalls(content);
    content = parsed.content;
    for (const call of parsed.toolCalls) {
      if (!toolCalls.some((t) => t.name === call.name)) {
        toolCalls.push(call);
      }
    }

    this.logger.debug(`chat done: ${content.length} chars, ${toolCalls.length} tool calls`);
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

function parseTextToolCalls(content: string): { content: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  const cleaned = content
    .replace(/<function=([^>]+)>([\s\S]*?)<\/function>/gi, (_, name: string, argsRaw: string) => {
      let args: Record<string, unknown> = {};
      try {
        args = argsRaw?.trim() ? (JSON.parse(argsRaw.trim()) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      toolCalls.push({
        id: `text_call_${toolCalls.length}_${Date.now()}`,
        name: name.trim(),
        arguments: args,
      });
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { content: cleaned, toolCalls };
}
