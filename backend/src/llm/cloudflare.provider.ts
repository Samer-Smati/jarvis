import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmChatOptions, LlmChatResult, LlmProvider } from './llm.types';
import {
  cappedRetryAfterMs,
  isModelNotFoundError,
  isRateLimitError,
  sleep,
  streamOpenAiChat,
} from './openai-stream.util';

/** Workers AI free tier: 10,000 Neurons/day, no credit card, resets daily at 00:00 UTC.
 * developers.cloudflare.com/workers-ai/platform/pricing */
const DEFAULT_MODEL = '@cf/openai/gpt-oss-120b';
const DEFAULT_FALLBACK_MODELS = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
];

/** Cloudflare Workers AI — genuinely free, no-card daily quota via an OpenAI-compatible endpoint.
 * https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/ */
@Injectable()
export class CloudflareProvider implements LlmProvider {
  readonly name = 'cloudflare';
  private readonly logger = new Logger(CloudflareProvider.name);
  private readonly apiKey: string;
  private readonly accountId: string;
  private readonly model: string;
  private readonly fallbackModels: string[];
  private readonly baseUrl: string;
  private resolvedModels: string[] | null = null;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('CLOUDFLARE_API_TOKEN')?.trim() ?? '';
    this.accountId = config.get<string>('CLOUDFLARE_ACCOUNT_ID')?.trim() ?? '';
    this.model = config.get<string>('CLOUDFLARE_MODEL') ?? DEFAULT_MODEL;
    const configured = config.get<string>('CLOUDFLARE_FALLBACK_MODELS');
    this.fallbackModels = configured
      ? configured.split(',').map((m) => m.trim()).filter(Boolean)
      : DEFAULT_FALLBACK_MODELS;
    this.baseUrl = this.accountId
      ? `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/v1`
      : '';
  }

  async isReady(): Promise<{ ok: boolean; model?: string; error?: string }> {
    if (!this.apiKey) {
      return {
        ok: false,
        error: 'Set CLOUDFLARE_API_TOKEN (free at dash.cloudflare.com, no card required)',
      };
    }
    if (!this.accountId) {
      return { ok: false, error: 'Set CLOUDFLARE_ACCOUNT_ID (found on the Cloudflare dashboard overview page)' };
    }
    const chain = this.buildModelChain();
    return { ok: true, model: chain[0] };
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    if (!this.apiKey || !this.accountId) {
      throw new Error(
        'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set. Free, no-card signup at dash.cloudflare.com',
      );
    }
    return this.chatWithFallbacks(options);
  }

  private async chatWithFallbacks(options: LlmChatOptions): Promise<LlmChatResult> {
    const models = this.buildModelChain();
    let lastError = 'Cloudflare Workers AI request failed';

    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await streamOpenAiChat(
            {
              apiKey: this.apiKey,
              baseUrl: this.baseUrl,
              model,
              providerLabel: 'Cloudflare Workers AI',
            },
            options,
          );
        } catch (error) {
          lastError = (error as Error).message;
          if (isModelNotFoundError(lastError)) {
            this.logger.warn(`Cloudflare model unavailable: ${model}`);
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
            this.logger.warn(`Cloudflare ${model} failed: ${lastError}`);
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
    this.logger.log(`Cloudflare model chain: ${this.resolvedModels.join(' → ')}`);
    return this.resolvedModels;
  }
}
