import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaudeProvider } from './claude.provider';
import { EnsureLlmService } from './ensure-llm.service';
import { GeminiProvider } from './gemini.provider';
import { GroqProvider } from './groq.provider';
import { isServerlessLlmProvider } from './llm-provider.util';
import { OpenRouterProvider } from './openrouter.provider';
import { XaiProvider } from './xai.provider';
import { LlmChatOptions, LlmChatResult, LlmProvider } from './llm.types';
import { LmStudioProvider } from './lmstudio.provider';
import { OllamaProvider } from './ollama.provider';

const CLOUD_FALLBACK_ORDER = ['gemini', 'openrouter', 'groq', 'claude', 'xai'] as const;

/** Facade over the configured providers; the active one can be switched at runtime. */
@Injectable()
export class LlmService implements LlmProvider {
  private readonly logger = new Logger(LlmService.name);
  private active: LlmProvider;
  private readonly providers: Map<string, LlmProvider>;
  private readyCache: { at: number; value: { ok: boolean; model?: string; error?: string } } | null = null;
  private readonly readyTtlMs = 30_000;

  constructor(
    config: ConfigService,
    ollama: OllamaProvider,
    claude: ClaudeProvider,
    groq: GroqProvider,
    gemini: GeminiProvider,
    openrouter: OpenRouterProvider,
    xai: XaiProvider,
    lmstudio: LmStudioProvider,
    private readonly ensureLlm: EnsureLlmService,
  ) {
    this.providers = new Map<string, LlmProvider>([
      [ollama.name, ollama],
      [claude.name, claude],
      [groq.name, groq],
      [gemini.name, gemini],
      [openrouter.name, openrouter],
      [xai.name, xai],
      [lmstudio.name, lmstudio],
    ]);
    const configured = config.get<string>('LLM_PROVIDER') ?? 'ollama';
    this.active = this.providers.get(configured) ?? gemini;
  }

  get name(): string {
    return this.active.name;
  }

  get available(): string[] {
    return [...this.providers.keys()];
  }

  setProvider(name: string): boolean {
    const provider = this.providers.get(name);
    if (!provider) {
      return false;
    }
    this.active = provider;
    return true;
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    await this.ensureLocalRuntime();
    if (!isServerlessLlmProvider(this.active.name)) {
      return this.active.chat(options);
    }
    return this.chatWithCloudFallback(options);
  }

  private async chatWithCloudFallback(options: LlmChatOptions): Promise<LlmChatResult> {
    const order = [
      this.active.name,
      ...CLOUD_FALLBACK_ORDER.filter((name) => name !== this.active.name),
    ];
    let lastError = 'Cloud LLM request failed';

    for (const name of order) {
      const provider = this.providers.get(name);
      if (!provider) {
        continue;
      }
      const probe = provider as LlmProvider & {
        isReady?: () => Promise<{ ok: boolean; model?: string; error?: string }>;
      };
      if (probe.isReady) {
        const ready = await probe.isReady();
        if (!ready.ok) {
          continue;
        }
      }
      try {
        if (name !== this.active.name) {
          this.logger.warn(`Cloud fallback: trying ${name}`);
        }
        return await provider.chat(options);
      } catch (error) {
        lastError = (error as Error).message;
        this.logger.warn(`${name} failed: ${lastError.slice(0, 200)}`);
      }
    }

    throw new Error(lastError);
  }

  async isReady(): Promise<{ ok: boolean; model?: string; error?: string }> {
    if (this.readyCache && Date.now() - this.readyCache.at < this.readyTtlMs) {
      return this.readyCache.value;
    }
    const probe = this.active as LlmProvider & {
      isReady?: () => Promise<{ ok: boolean; model?: string; error?: string }>;
    };
    const value = probe.isReady ? await probe.isReady() : { ok: true };
    this.readyCache = { at: Date.now(), value };
    return value;
  }

  /** Start LM Studio / Ollama with a default model when nothing is online. */
  async ensureLocalRuntime(): Promise<void> {
    if (process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1') {
      if (isServerlessLlmProvider(this.active.name)) {
        return;
      }
      throw new Error(
        'Serverless JARVIS needs a cloud LLM. Set GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY, or XAI_API_KEY on Vercel.',
      );
    }
    if (isServerlessLlmProvider(this.active.name)) {
      return;
    }

    const ready = await this.isReady();
    if (ready.ok) {
      return;
    }

    const mode = process.env.JARVIS_LLM_ENSURE ?? 'probe';
    if (mode !== 'full') {
      throw new Error(
        'Local LLM is offline. Start LM Studio or Ollama manually, or set JARVIS_LLM_ENSURE=full for auto-start.',
      );
    }

    const ensured = await this.ensureLlm.ensureReady(this.active.name);
    if (!ensured.ok || !ensured.provider) {
      throw new Error(ensured.error ?? 'No local LLM is available.');
    }

    this.setProvider(ensured.provider);
  }
}
