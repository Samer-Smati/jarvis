import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatMessage,
  LlmChatOptions,
  LlmChatResult,
  LlmProvider,
  ToolCall,
} from './llm.types';

@Injectable()
export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude';
  private readonly logger = new Logger(ClaudeProvider.name);
  private client?: Anthropic;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('ANTHROPIC_API_KEY') ?? '';
    this.model = config.get<string>('CLAUDE_MODEL') ?? 'claude-sonnet-4-20250514';
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    const client = this.getClient();
    const system = options.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const stream = client.messages.stream(
      {
        model: this.model,
        max_tokens: 4096,
        system: system || undefined,
        messages: this.toAnthropicMessages(options.messages),
        tools: options.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
      },
      { signal: options.signal },
    );

    stream.on('text', (text) => options.onToken?.(text));

    const final = await stream.finalMessage();
    let content = '';
    const toolCalls: ToolCall[] = [];
    for (const block of final.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    this.logger.debug(`chat done: ${content.length} chars, ${toolCalls.length} tool calls`);
    return { content, toolCalls };
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    return this.client;
  }

  private toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];
    for (const message of messages) {
      if (message.role === 'system') {
        continue;
      }
      if (message.role === 'tool') {
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.toolCallId ?? '',
              content: message.content,
            },
          ],
        });
      } else if (message.role === 'assistant' && message.toolCalls?.length) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (message.content) {
          blocks.push({ type: 'text', text: message.content });
        }
        for (const call of message.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
        result.push({ role: 'assistant', content: blocks });
      } else {
        result.push({ role: message.role, content: message.content });
      }
    }
    return result;
  }
}
