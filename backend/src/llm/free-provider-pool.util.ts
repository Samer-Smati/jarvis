import {
  isDailyQuotaExhaustedError,
  isRateLimitError,
  parseRetryAfterMs,
} from './openai-stream.util';

/** Free-tier cloud LLMs JARVIS rotates between (speed-first, then multimodal, then broad fallback). */
export const FREE_LLM_PROVIDERS = ['groq', 'gemini', 'openrouter'] as const;

export type FreeLlmProvider = (typeof FREE_LLM_PROVIDERS)[number];

const FREE_PROVIDER_ENV_KEYS: Record<FreeLlmProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const cooldownUntil = new Map<string, number>();

export function isFreeLlmProvider(name: string): name is FreeLlmProvider {
  return FREE_LLM_PROVIDERS.includes(name as FreeLlmProvider);
}

export function isFreeProviderConfigured(name: FreeLlmProvider): boolean {
  return Boolean(process.env[FREE_PROVIDER_ENV_KEYS[name]]?.trim());
}

/** Configured free providers in preferred failover order. */
export function listConfiguredFreeProviders(): FreeLlmProvider[] {
  return FREE_LLM_PROVIDERS.filter(isFreeProviderConfigured);
}

/** Build try order: preferred route provider first, then remaining free providers. */
export function buildFreeProviderTryOrder(preferred?: string): string[] {
  const configured = listConfiguredFreeProviders();
  if (!configured.length) {
    return preferred ? [preferred] : [];
  }
  const order: string[] = [];
  if (preferred && configured.includes(preferred as FreeLlmProvider)) {
    order.push(preferred);
  } else if (preferred && isFreeLlmProvider(preferred)) {
    order.push(preferred);
  }
  for (const name of configured) {
    if (!order.includes(name)) {
      order.push(name);
    }
  }
  return order;
}

export function isPayloadTooLargeError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    message.includes('413') ||
    lower.includes('request too large') ||
    lower.includes('context length') ||
    lower.includes('token limit') ||
    lower.includes('maximum context')
  );
}

export function isAuthProviderError(message: string): boolean {
  return (
    message.includes('401') ||
    message.includes('403') ||
    message.toLowerCase().includes('invalid api key') ||
    message.toLowerCase().includes('incorrect api key') ||
    message.toLowerCase().includes('permission denied')
  );
}

export function isTransientProviderError(message: string): boolean {
  return message.includes('502') || message.includes('503') || message.includes('504');
}

/** Errors where trying the next free provider may succeed immediately. */
export function isSwitchableProviderError(message: string): boolean {
  return (
    isRateLimitError(message) ||
    isDailyQuotaExhaustedError(message) ||
    isPayloadTooLargeError(message) ||
    isAuthProviderError(message) ||
    isTransientProviderError(message)
  );
}

export function providerCooldownMs(message: string): number {
  if (isDailyQuotaExhaustedError(message)) {
    const resetMs = parseOpenRouterResetMs(message);
    return resetMs ?? 6 * 60 * 60 * 1000;
  }
  if (isAuthProviderError(message)) {
    return 30 * 60 * 1000;
  }
  if (isRateLimitError(message)) {
    return Math.min((parseRetryAfterMs(message) ?? 60_000) + 500, 15_000);
  }
  if (isTransientProviderError(message)) {
    return 15_000;
  }
  return 0;
}

function parseOpenRouterResetMs(message: string): number | null {
  const match = message.match(/X-RateLimit-Reset["\s:]+(\d+)/i);
  if (!match?.[1]) {
    return null;
  }
  const resetAt = parseInt(match[1], 10);
  if (!Number.isFinite(resetAt)) {
    return null;
  }
  const delta = resetAt - Date.now();
  return delta > 0 ? delta : null;
}

export function markProviderCooldown(provider: string, errorMessage: string): void {
  const ms = providerCooldownMs(errorMessage);
  if (ms <= 0) {
    return;
  }
  cooldownUntil.set(provider, Date.now() + ms);
}

export function isProviderInCooldown(provider: string): boolean {
  const until = cooldownUntil.get(provider);
  if (!until) {
    return false;
  }
  if (Date.now() >= until) {
    cooldownUntil.delete(provider);
    return false;
  }
  return true;
}

export function clearProviderCooldown(provider: string): void {
  cooldownUntil.delete(provider);
}

/** Reset cooldowns — exposed for tests. */
export function resetProviderCooldowns(): void {
  cooldownUntil.clear();
}

export function resolvePreferredFreeProvider(): string {
  const configured = listConfiguredFreeProviders();
  if (!configured.length) {
    return process.env.LLM_PROVIDER ?? 'gemini';
  }
  const explicit = process.env.LLM_PROVIDER?.trim();
  if (explicit && isFreeLlmProvider(explicit) && isFreeProviderConfigured(explicit)) {
    return explicit;
  }
  return configured[0];
}
