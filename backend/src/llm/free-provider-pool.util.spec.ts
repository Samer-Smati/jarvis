import {
  buildFreeProviderTryOrder,
  isProviderInCooldown,
  isSwitchableProviderError,
  listConfiguredFreeProviders,
  markProviderCooldown,
  resetProviderCooldowns,
  resolvePreferredFreeProvider,
} from './free-provider-pool.util';

describe('free-provider-pool.util', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    resetProviderCooldowns();
  });

  afterAll(() => {
    process.env = env;
  });

  it('lists providers in speed-first failover order', () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    process.env.OPENROUTER_API_KEY = 'o';

    expect(listConfiguredFreeProviders()).toEqual(['groq', 'gemini', 'openrouter']);
  });

  it('puts preferred provider first in try order', () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    process.env.OPENROUTER_API_KEY = 'o';

    expect(buildFreeProviderTryOrder('gemini')).toEqual(['gemini', 'groq', 'openrouter']);
  });

  it('detects switchable rate-limit and daily quota errors', () => {
    expect(
      isSwitchableProviderError('OpenRouter request failed (429): free-models-per-day'),
    ).toBe(true);
    expect(isSwitchableProviderError('Groq request failed (429): tokens per minute')).toBe(true);
    expect(isSwitchableProviderError('Gemini request failed (500): internal')).toBe(false);
  });

  it('resolves groq as default when all free keys are configured', () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    delete process.env.LLM_PROVIDER;

    expect(resolvePreferredFreeProvider()).toBe('groq');
  });

  it('respects explicit LLM_PROVIDER when that key is configured', () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    process.env.LLM_PROVIDER = 'groq';

    expect(resolvePreferredFreeProvider()).toBe('groq');
  });

  it('marks empty-response providers in short cooldown', () => {
    markProviderCooldown('groq', 'empty response');
    expect(isProviderInCooldown('groq')).toBe(true);
  });

  it('requires both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID before treating cloudflare as configured', () => {
    process.env.CLOUDFLARE_API_TOKEN = 't';
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    expect(listConfiguredFreeProviders()).not.toContain('cloudflare');

    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    expect(listConfiguredFreeProviders()).toContain('cloudflare');
  });

  it('puts cloudflare last — a safety net behind groq/gemini/openrouter, not a default pick', () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.CLOUDFLARE_API_TOKEN = 't';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';

    expect(listConfiguredFreeProviders()).toEqual(['groq', 'gemini', 'openrouter', 'cloudflare']);
  });
});
