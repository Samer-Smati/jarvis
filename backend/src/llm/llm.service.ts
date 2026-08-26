import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaudeProvider } from './claude.provider';
import { CloudflareProvider } from './cloudflare.provider';
import { EnsureLlmService } from './ensure-llm.service';
import { GeminiProvider } from './gemini.provider';
import { GroqProvider } from './groq.provider';
import { isServerlessLlmProvider } from './llm-provider.util';
import { normalizeToolCalls } from '../skills/tool-schema.normalizer';
import { parseTextToolCallsFromContent, sanitizeUserFacingAssistantText } from './text-tool-call.util';
import { OpenRouterProvider } from './openrouter.provider';
import { XaiProvider } from './xai.provider';
import { LmStudioProvider } from './lmstudio.provider';
import { OllamaProvider } from './ollama.provider';
import { LlmChatOptions, LlmChatResult, LlmProvider, ChatMessage } from './llm.types';
import {
  buildFreeProviderTryOrder,
  clearProviderCooldown,
  isProviderInCooldown,
  isSwitchableProviderError,
  listConfiguredFreeProviders,
  markProviderCooldown,
} from './free-provider-pool.util';
import {
  providerCanAcceptMessages,
  providerInputCharCap,
  trimMessagesForLlm,
} from './message-trim.util';

/** Cloud provider returned no prose and no tool calls — rotate like a soft failure. */
export function isEmptyLlmResult(result: Pick<LlmChatResult, 'content' | 'toolCalls'>): boolean {
  if (result.toolCalls?.length) {
    return false;
  }
  return !(result.content?.trim());
}

/** Facade over the configured providers; the active one can be switched at runtime. */
@Injectable()
export class LlmService implements LlmProvider {
  private readonly logger = new Logger(LlmService.name);
  private active: LlmProvider;
  private readonly providers: Map<string, LlmProvider>;
  private readyCache: { at: number; value: { ok: boolean; model?: string; error?: string; provider?: string } } | null =
    null;
  private readonly readyTtlMs = 30_000;
  private lastServingProvider?: string;
  private lastServingModel?: string;
  private manuallySelected = false;

  constructor(
    config: ConfigService,
    ollama: OllamaProvider,
    claude: ClaudeProvider,
    groq: GroqProvider,
    gemini: GeminiProvider,
    openrouter: OpenRouterProvider,
    xai: XaiProvider,
    cloudflare: CloudflareProvider,
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
      [cloudflare.name, cloudflare],
      [lmstudio.name, lmstudio],
    ]);
    const configured = config.get<string>('LLM_PROVIDER') ?? 'ollama';
    this.active = this.providers.get(configured) ?? gemini;
  }

  get name(): string {
    return this.active.name;
  }

  /** True once the user has picked a provider via setManualProvider() — task-routing no longer
   * overrides it. False means the active provider is still just the LLM_PROVIDER env default. */
  get isManuallySelected(): boolean {
    return this.manuallySelected;
  }

  get servingProvider(): string | undefined {
    return this.lastServingProvider;
  }

  get servingModel(): string | undefined {
    return this.lastServingModel;
  }

  private recordServing(providerName: string, model?: string): void {
    this.lastServingProvider = providerName;
    if (model) {
      this.lastServingModel = model;
    }
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

  /** User explicitly picked this provider (Settings dropdown / POST /api/provider) — sticky
   * until they pick another one. Distinct from setProvider(), which task-routing also calls for
   * a single call and reverts afterward; a manual pick must survive that per-call override. */
  setManualProvider(name: string): boolean {
    if (!this.setProvider(name)) {
      return false;
    }
    this.manuallySelected = true;
    return true;
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    await this.ensureLocalRuntime();
    const previous = this.active;
    // A manual pick wins over task-routing's provider choice — it still goes through
    // chatWithCloudFallback's health checks/cooldowns/auto-failover below, it's just the
    // preferred first try instead of being silently overridden every turn.
    const routeProvider = this.manuallySelected ? undefined : options.route?.provider;
    const providerName = routeProvider ?? this.active.name;

    if (routeProvider) {
      this.setProvider(routeProvider);
    }
    try {
      let result: LlmChatResult;
      if (!isServerlessLlmProvider(this.active.name)) {
        const charCap = providerInputCharCap(providerName);
        const trimmedMessages = trimMessagesForLlm(options.messages, charCap);
        result = await this.active.chat({ ...options, messages: trimmedMessages });
        this.recordServing(this.active.name);
      } else {
        result = await this.chatWithCloudFallback(options);
      }
      if (options.tools?.length) {
        const originalContent = result.content;
        const parsed = parseTextToolCallsFromContent(originalContent);
        result = {
          ...result,
          content: sanitizeUserFacingAssistantText(parsed.content),
          toolCalls: normalizeToolCalls(result.toolCalls, originalContent, options.tools),
        };
      } else {
        result = {
          ...result,
          content: sanitizeUserFacingAssistantText(result.content),
        };
      }
      return result;
    } finally {
      if (routeProvider && previous.name !== this.active.name) {
        this.active = previous;
      }
    }
  }

  chatWithRoute(userText: string, options: LlmChatOptions): Promise<LlmChatResult> {
    return this.chat(options).then((result) => {
      const tokens = estimateTokens(options.messages, result.content);
      return result;
    });
  }

  private async chatWithCloudFallback(options: LlmChatOptions): Promise<LlmChatResult> {
    const preferred = this.active.name;
    const order = buildFreeProviderTryOrder(preferred);
    if (!order.length) {
      throw new Error(
        'No free cloud LLM configured. Set GEMINI_API_KEY, GROQ_API_KEY, and/or OPENROUTER_API_KEY.',
      );
    }

    let lastError = 'Cloud LLM request failed';

    for (const name of order) {
      if (isProviderInCooldown(name)) {
        this.logger.warn(`Free LLM skip: ${name} — cooling down after a recent limit`);
        continue;
      }

      const provider = this.providers.get(name);
      if (!provider) {
        continue;
      }

      const trimmedMessages = trimMessagesForLlm(options.messages, providerInputCharCap(name));
      if (!providerCanAcceptMessages(name, trimmedMessages)) {
        this.logger.warn(`Free LLM skip: ${name} — payload too large (${trimmedMessages.length} messages)`);
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
        if (name !== preferred) {
          this.logger.warn(`Free LLM failover: trying ${name}`);
        }
        const result = await provider.chat({ ...options, messages: trimmedMessages });
        if (isEmptyLlmResult(result)) {
          markProviderCooldown(name, 'empty response');
          this.logger.warn(`${name} returned an empty reply — rotating to next free provider`);
          continue;
        }
        if (name !== preferred) {
          clearProviderCooldown(name);
        }
        const probeAfter = provider as LlmProvider & {
          isReady?: () => Promise<{ ok: boolean; model?: string }>;
        };
        const readyAfter = probeAfter.isReady ? await probeAfter.isReady() : { ok: true };
        this.recordServing(name, readyAfter.model);
        return result;
      } catch (error) {
        lastError = (error as Error).message;
        if (isSwitchableProviderError(lastError)) {
          markProviderCooldown(name, lastError);
          this.logger.warn(`${name} unavailable — rotating to next free provider`);
          continue;
        }
        this.logger.warn(`${name} failed: ${lastError.slice(0, 200)}`);
      }
    }

    throw new Error(
      order.length > 1
        ? `All free LLM providers are unavailable. Last error: ${lastError}`
        : lastError,
    );
  }

  async isReady(): Promise<{ ok: boolean; model?: string; error?: string; provider?: string }> {
    if (this.readyCache && Date.now() - this.readyCache.at < this.readyTtlMs) {
      return this.readyCache.value;
    }

    const activeReady = await this.isReadyForProvider(this.active.name);
    if (activeReady.ok) {
      const value = { ...activeReady, provider: this.active.name };
      this.readyCache = { at: Date.now(), value };
      return value;
    }

    const serverless = Boolean(process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1');
    if (serverless || isServerlessLlmProvider(this.active.name)) {
      for (const name of listConfiguredFreeProviders()) {
        if (name === this.active.name || isProviderInCooldown(name)) {
          continue;
        }
        const ready = await this.isReadyForProvider(name);
        if (ready.ok) {
          const value = {
            ...ready,
            provider: name,
            error: activeReady.error
              ? `Configured provider "${this.active.name}" unavailable (${activeReady.error}); fallback ${name} is ready.`
              : undefined,
          };
          this.readyCache = { at: Date.now(), value };
          return value;
        }
      }
      const value = {
        ok: false,
        provider: this.active.name,
        error:
          activeReady.error ??
          'No free cloud LLM available. Set GEMINI_API_KEY, GROQ_API_KEY, and/or OPENROUTER_API_KEY.',
      };
      this.readyCache = { at: Date.now(), value };
      return value;
    }

    const value = { ...activeReady, provider: this.active.name };
    this.readyCache = { at: Date.now(), value };
    return value;
  }

  private async isReadyForProvider(
    name: string,
  ): Promise<{ ok: boolean; model?: string; error?: string }> {
    const provider = this.providers.get(name) as LlmProvider & {
      isReady?: () => Promise<{ ok: boolean; model?: string; error?: string }>;
    };
    if (!provider) {
      return { ok: false, error: `Unknown provider "${name}".` };
    }
    if (provider.isReady) {
      return provider.isReady();
    }
    return { ok: true };
  }

  /** Start LM Studio / Ollama with a default model when nothing is online. */
  async ensureLocalRuntime(): Promise<void> {
    if (process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1') {
      if (isServerlessLlmProvider(this.active.name)) {
        return;
      }
      throw new Error(
        'Serverless JARVIS needs a free cloud LLM. Set GEMINI_API_KEY, GROQ_API_KEY, and/or OPENROUTER_API_KEY on Vercel.',
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

function estimateTokens(messages: ChatMessage[], response: string): number {
  const inputChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  return Math.ceil((inputChars + response.length) / 4);
}
