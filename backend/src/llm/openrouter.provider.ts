import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmChatOptions, LlmChatResult, LlmProvider } from './llm.types';
import {
  isModelNotFoundError,
  isRateLimitError,
  listOpenAiModels,
  parseRetryAfterMs,
  resolveModelChain,
  sleep,
  streamOpenAiChat,
} from './openai-stream.util';

const DEFAULT_MODEL = 'openrouter/free';
const DEFAULT_FALLBACK_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'qwen/qwen-2.5-7b-instruct:free',
];

/** OpenRouter — one API key, many free models. https://openrouter.ai */
@Injectable()
export class OpenRouterProvider implements LlmProvider {
  readonly name = 'openrouter';
  private readonly logger = new Logger(OpenRouterProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallbackModels: string[];
  private readonly baseUrl: string;
  private readonly appUrl: string;
  private readonly appName: string;
  private resolvedModels: string[] | null = null;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('OPENROUTER_API_KEY') ?? '';
    this.model = config.get<string>('OPENROUTER_MODEL') ?? DEFAULT_MODEL;
    const configured = config.get<string>('OPENROUTER_FALLBACK_MODELS');
    this.fallbackModels = configured
      ? configured.split(',').map((m) => m.trim()).filter(Boolean)
      : DEFAULT_FALLBACK_MODELS;
    this.baseUrl = config.get<string>('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1';
    this.appUrl = config.get<string>('JARVIS_APP_URL') ?? 'https://frontend-pearl-omega-53.vercel.app';
    this.appName = config.get<string>('JARVIS_APP_NAME') ?? 'JARVIS';
  }

  async isReady(): Promise<{ ok: boolean; model?: string; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: 'Set OPENROUTER_API_KEY (free at openrouter.ai/keys)' };
    }
    const chain = await this.resolveModelChain();
    if (!chain.length) {
      return { ok: false, error: 'No OpenRouter models configured' };
    }
    return { ok: true, model: chain[0] };
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set. Get a key at https://openrouter.ai/keys');
    }
    return this.chatWithFallbacks(options);
  }

  private extraHeaders(): Record<string, string> {
    return {
      'HTTP-Referer': this.appUrl,
      'X-Title': this.appName,
    };
  }

  private async chatWithFallbacks(options: LlmChatOptions): Promise<LlmChatResult> {
    const models = await this.resolveModelChain();
    let lastError = 'OpenRouter request failed';

    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await streamOpenAiChat(
            {
              apiKey: this.apiKey,
              baseUrl: this.baseUrl,
              model,
              providerLabel: 'OpenRouter',
              extraHeaders: this.extraHeaders(),
            },
            options,
          );
        } catch (error) {
          lastError = (error as Error).message;
          if (isModelNotFoundError(lastError)) {
            this.resolvedModels = null;
            break;
          }
          const retryMs = parseRetryAfterMs(lastError);
          if (retryMs != null && attempt < 2) {
            await sleep(retryMs + 200);
            continue;
          }
          if (isRateLimitError(lastError) && model !== models[models.length - 1]) {
            break;
          }
          if (model !== models[models.length - 1]) {
            this.logger.warn(`OpenRouter ${model} failed: ${lastError}`);
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
    const available = await listOpenAiModels(this.apiKey, this.baseUrl);
    const chain = resolveModelChain(this.model, this.fallbackModels, available, DEFAULT_FALLBACK_MODELS);
    this.resolvedModels = chain;
    if (chain.length) {
      this.logger.log(`OpenRouter model chain: ${chain.join(' → ')}`);
    }
    return chain;
  }
}
