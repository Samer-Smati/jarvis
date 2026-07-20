import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatMessage, LlmChatOptions, LlmChatResult, LlmProvider } from './llm.types';
import {
  isModelNotFoundError,
  isRateLimitError,
  listOpenAiModels,
  parseRetryAfterMs,
  resolveModelChain,
  sleep,
  streamOpenAiChat,
} from './openai-stream.util';

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_FALLBACK_MODELS = ['gemini-2.0-flash-lite', 'gemini-1.5-flash'];

/** Google Gemini — generous free tier via OpenAI-compatible API. https://aistudio.google.com */
@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallbackModels: string[];
  private readonly baseUrl: string;
  private resolvedModels: string[] | null = null;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GEMINI_API_KEY') ?? '';
    this.model = config.get<string>('GEMINI_MODEL') ?? DEFAULT_MODEL;
    const configured = config.get<string>('GEMINI_FALLBACK_MODELS');
    this.fallbackModels = configured
      ? configured.split(',').map((m) => m.trim()).filter(Boolean)
      : DEFAULT_FALLBACK_MODELS;
    this.baseUrl =
      config.get<string>('GEMINI_BASE_URL') ??
      'https://generativelanguage.googleapis.com/v1beta/openai';
  }

  async isReady(): Promise<{ ok: boolean; model?: string; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: 'Set GEMINI_API_KEY (free at aistudio.google.com/apikey)' };
    }
    const chain = await this.resolveModelChain();
    if (!chain.length) {
      return { ok: false, error: 'No Gemini models configured' };
    }
    return { ok: true, model: chain[0] };
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey');
    }
    return this.chatWithFallbacks(options);
  }

  private async chatWithFallbacks(options: LlmChatOptions): Promise<LlmChatResult> {
    const models = await this.resolveModelChain();
    let lastError = 'Gemini request failed';

    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await streamOpenAiChat(
            {
              apiKey: this.apiKey,
              baseUrl: this.baseUrl,
              model,
              providerLabel: 'Gemini',
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
            this.logger.warn(`Gemini ${model} failed: ${lastError}`);
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
      this.logger.log(`Gemini model chain: ${chain.join(' → ')}`);
    }
    return chain;
  }
}
