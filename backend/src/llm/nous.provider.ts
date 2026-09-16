import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmChatOptions, LlmChatResult, LlmProvider } from './llm.types';
import {
  cappedRetryAfterMs,
  isDailyQuotaExhaustedError,
  isModelNotFoundError,
  isRateLimitError,
  listOpenAiModels,
  resolveModelChain,
  sleep,
  streamOpenAiChat,
} from './openai-stream.util';

const DEFAULT_MODEL = 'hermes/hermes-4-70b';
const DEFAULT_FALLBACK_MODELS = [
  'hermes/hermes-4-405b',
  'hermes/hermes-4-70b',
  'deepseek/deepseek-v4-pro',
];

/**
 * Nous Portal — Nous Research's OpenAI-compatible endpoint. Serves the Hermes models
 * plus a broad third-party catalogue behind one key. https://inference-api.nousresearch.com
 *
 * The Hermes CLI authenticates over OAuth and mints short-lived JWTs; this provider uses the
 * Portal API key as a plain bearer token, which is what the HTTP API accepts and what fits
 * the rest of JARVIS's providers.
 */
@Injectable()
export class NousProvider implements LlmProvider {
  readonly name = 'nous';
  private readonly logger = new Logger(NousProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallbackModels: string[];
  private readonly baseUrl: string;
  private readonly appUrl: string;
  private readonly appName: string;
  private resolvedModels: string[] | null = null;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('NOUS_API_KEY') ?? '';
    this.model = config.get<string>('NOUS_MODEL') ?? DEFAULT_MODEL;
    const configured = config.get<string>('NOUS_FALLBACK_MODELS');
    this.fallbackModels = configured
      ? configured.split(',').map((m) => m.trim()).filter(Boolean)
      : DEFAULT_FALLBACK_MODELS;
    this.baseUrl =
      config.get<string>('NOUS_BASE_URL') ?? 'https://inference-api.nousresearch.com/v1';
    this.appUrl = config.get<string>('JARVIS_APP_URL') ?? 'https://frontend-pearl-omega-53.vercel.app';
    this.appName = config.get<string>('JARVIS_APP_NAME') ?? 'JARVIS';
  }

  async isReady(): Promise<{ ok: boolean; model?: string; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: 'Set NOUS_API_KEY (Nous Portal → API keys)' };
    }
    const chain = await this.resolveModelChain();
    if (!chain.length) {
      return { ok: false, error: 'No Nous Portal models configured' };
    }
    return { ok: true, model: chain[0] };
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    if (!this.apiKey) {
      throw new Error('NOUS_API_KEY is not set. Create one at https://portal.nousresearch.com');
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
    let lastError = 'Nous Portal request failed';

    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await streamOpenAiChat(
            {
              apiKey: this.apiKey,
              baseUrl: this.baseUrl,
              model,
              providerLabel: 'Nous Portal',
              extraHeaders: this.extraHeaders(),
            },
            options,
          );
        } catch (error) {
          lastError = (error as Error).message;
          if (isDailyQuotaExhaustedError(lastError)) {
            throw error;
          }
          if (isModelNotFoundError(lastError)) {
            this.resolvedModels = null;
            break;
          }
          const retryMs = cappedRetryAfterMs(lastError);
          if (retryMs != null && attempt < 2) {
            await sleep(retryMs + 200);
            continue;
          }
          if (isRateLimitError(lastError) && model !== models[models.length - 1]) {
            break;
          }
          if (model !== models[models.length - 1]) {
            this.logger.warn(`Nous Portal ${model} failed: ${lastError}`);
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
      this.logger.log(`Nous Portal model chain: ${chain.join(' → ')}`);
    }
    return chain;
  }
}
