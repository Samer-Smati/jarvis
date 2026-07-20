import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaudeProvider } from './claude.provider';
import { EnsureLlmService } from './ensure-llm.service';
import { GroqProvider } from './groq.provider';
import { XaiProvider } from './xai.provider';
import { LlmChatOptions, LlmChatResult, LlmProvider } from './llm.types';
import { LmStudioProvider } from './lmstudio.provider';
import { OllamaProvider } from './ollama.provider';

/** Facade over the configured providers; the active one can be switched at runtime. */
@Injectable()
export class LlmService implements LlmProvider {
  private active: LlmProvider;
  private readonly providers: Map<string, LlmProvider>;
  private readyCache: { at: number; value: { ok: boolean; model?: string; error?: string } } | null = null;
  private readonly readyTtlMs = 30_000;

  constructor(
    config: ConfigService,
    ollama: OllamaProvider,
    claude: ClaudeProvider,
    groq: GroqProvider,
    xai: XaiProvider,
    lmstudio: LmStudioProvider,
    private readonly ensureLlm: EnsureLlmService,
  ) {
    this.providers = new Map<string, LlmProvider>([
      [ollama.name, ollama],
      [claude.name, claude],
      [groq.name, groq],
      [xai.name, xai],
      [lmstudio.name, lmstudio],
    ]);
    const configured = config.get<string>('LLM_PROVIDER') ?? 'ollama';
    this.active = this.providers.get(configured) ?? groq;
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
    return this.active.chat(options);
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
      if (this.active.name === 'claude' || this.active.name === 'groq' || this.active.name === 'xai') {
        return;
      }
      throw new Error(
        'Serverless JARVIS uses xAI, Groq or Claude. Set XAI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY on Vercel.',
      );
    }
    if (this.active.name === 'claude' || this.active.name === 'groq' || this.active.name === 'xai') {
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
