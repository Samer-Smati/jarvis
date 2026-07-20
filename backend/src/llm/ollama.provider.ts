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

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
}

@Injectable()
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  private readonly logger = new Logger(OllamaProvider.name);
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('OLLAMA_BASE_URL') ?? 'http://localhost:11434';
    this.model = config.get<string>('OLLAMA_CHAT_MODEL') ?? 'llama3.1';
  }

  async isReady(): Promise<{ ok: boolean; model?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) {
        return { ok: false, error: `Ollama returned ${response.status}` };
      }
      const data = (await response.json()) as { models?: { name: string }[] };
      const hasModel = data.models?.some((m) => m.name.startsWith(this.model));
      if (!hasModel && !data.models?.length) {
        return { ok: false, error: `No models found. Run: ollama pull ${this.model}` };
      }
      return { ok: true, model: this.model };
    } catch (error) {
      return {
        ok: false,
        error: describeLlmNetworkError(
          error,
          'Ollama',
          'Run: ollama serve && ollama pull llama3.2',
        ),
      };
    }
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    const perf =
      process.env.JARVIS_PERFORMANCE_MODE === '1' || process.env.JARVIS_PERFORMANCE_MODE === 'true';
    const body = {
      model: this.model,
      stream: true,
      keep_alive: '24h',
      messages: options.messages.map((m) => this.toOllamaMessage(m)),
      tools: options.tools?.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      ...(perf
        ? {
            options: {
              num_ctx: 2048,
              num_predict: 512,
              temperature: 0.6,
            },
          }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal ?? null,
      });
    } catch (error) {
      throw new Error(
        describeLlmNetworkError(
          error,
          'Ollama',
          'Run: ollama serve && ollama pull llama3.2',
        ),
      );
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`Ollama request failed (${response.status}): ${text}`);
    }

    let content = '';
    const toolCalls: ToolCall[] = [];
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
        if (!line.trim()) {
          continue;
        }
        const chunk = JSON.parse(line) as { message?: OllamaMessage; done?: boolean };
        const message = chunk.message;
        if (!message) {
          continue;
        }
        if (message.content) {
          content += message.content;
          options.onToken?.(message.content);
        }
        for (const call of message.tool_calls ?? []) {
          toolCalls.push({
            id: `call_${toolCalls.length}_${Date.now()}`,
            name: call.function.name,
            arguments: call.function.arguments ?? {},
          });
        }
      }
    }

    this.logger.debug(`chat done: ${content.length} chars, ${toolCalls.length} tool calls`);
    return { content, toolCalls };
  }

  private toOllamaMessage(message: ChatMessage): OllamaMessage {
    if (message.role === 'tool') {
      return { role: 'tool', content: message.content };
    }
    const result: OllamaMessage = { role: message.role, content: message.content };
    if (message.toolCalls?.length) {
      result.tool_calls = message.toolCalls.map((c) => ({
        function: { name: c.name, arguments: c.arguments },
      }));
    }
    return result;
  }
}
