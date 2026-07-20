import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmChatOptions, LlmChatResult, LlmProvider } from './llm.types';
import {
  isModelNotFoundError,
  isRateLimitError,
  parseRetryAfterMs,
  sleep,
  streamOpenAiChat,
} from './openai-stream.util';

/** Verified working on Google AI Studio free tier — do not auto-pick from /models list. */
const DEFAULT_MODEL = 'gemini-flash-latest';
const DEFAULT_FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite'];

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
    const chain = this.buildModelChain();
    return { ok: true, model: chain[0] };
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey');
    }
    return this.chatWithFallbacks(options);
  }

  private async chatWithFallbacks(options: LlmChatOptions): Promise<LlmChatResult> {
    const models = this.buildModelChain();
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
            this.logger.warn(`Gemini model unavailable: ${model}`);
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

  private buildModelChain(): string[] {
    if (this.resolvedModels?.length) {
      return this.resolvedModels;
    }
    const chain = [
      this.model,
      ...this.fallbackModels.filter((m) => m !== this.model),
      ...DEFAULT_FALLBACK_MODELS.filter(
        (m) => m !== this.model && !this.fallbackModels.includes(m),
      ),
    ];
    this.resolvedModels = [...new Set(chain.filter(Boolean))];
    this.logger.log(`Gemini model chain: ${this.resolvedModels.join(' → ')}`);
    return this.resolvedModels;
  }
}
