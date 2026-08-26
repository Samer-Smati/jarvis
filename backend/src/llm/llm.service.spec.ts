import { EnsureLlmService } from './ensure-llm.service';
import { LlmService } from './llm.service';
import { ClaudeProvider } from './claude.provider';
import { CloudflareProvider } from './cloudflare.provider';
import { GroqProvider } from './groq.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { XaiProvider } from './xai.provider';
import { LmStudioProvider } from './lmstudio.provider';
import { OllamaProvider } from './ollama.provider';
import { resetProviderCooldowns } from './free-provider-pool.util';

describe('LlmService ensureLocalRuntime', () => {
  let ensureLlm: jest.Mocked<Pick<EnsureLlmService, 'ensureReady'>>;
  let lmstudio: jest.Mocked<Pick<LmStudioProvider, 'name' | 'chat' | 'isReady'>>;
  let ollama: jest.Mocked<Pick<OllamaProvider, 'name' | 'chat' | 'isReady'>>;
  let claude: jest.Mocked<Pick<ClaudeProvider, 'name' | 'chat'>>;
  let groq: jest.Mocked<Pick<GroqProvider, 'name' | 'chat' | 'isReady'>>;
  let gemini: jest.Mocked<Pick<GeminiProvider, 'name' | 'chat' | 'isReady'>>;
  let openrouter: jest.Mocked<Pick<OpenRouterProvider, 'name' | 'chat' | 'isReady'>>;
  let xai: jest.Mocked<Pick<XaiProvider, 'name' | 'chat' | 'isReady'>>;
  let cloudflare: jest.Mocked<Pick<CloudflareProvider, 'name' | 'chat' | 'isReady'>>;
  let settings: { findOne: jest.Mock; upsert: jest.Mock };
  let service: LlmService;

  beforeEach(() => {
    delete process.env.VERCEL;
    delete process.env.JARVIS_SERVERLESS;
    process.env.JARVIS_LLM_ENSURE = 'full';
    resetProviderCooldowns();
    ensureLlm = { ensureReady: jest.fn() };
    lmstudio = {
      name: 'lmstudio',
      chat: jest.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      isReady: jest.fn(),
    };
    ollama = {
      name: 'ollama',
      chat: jest.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      isReady: jest.fn(),
    };
    claude = {
      name: 'claude',
      chat: jest.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
    };
    groq = {
      name: 'groq',
      chat: jest.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      isReady: jest.fn().mockResolvedValue({ ok: true, model: 'llama-3.3-70b-versatile' }),
    };
    gemini = {
      name: 'gemini',
      chat: jest.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      isReady: jest.fn().mockResolvedValue({ ok: true, model: 'gemini-2.0-flash' }),
    };
    openrouter = {
      name: 'openrouter',
      chat: jest.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      isReady: jest.fn().mockResolvedValue({ ok: true, model: 'google/gemini-2.0-flash-exp:free' }),
    };
    xai = {
      name: 'xai',
      chat: jest.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      isReady: jest.fn().mockResolvedValue({ ok: true, model: 'grok-3-fast' }),
    };
    cloudflare = {
      name: 'cloudflare',
      chat: jest.fn().mockResolvedValue({ content: 'hi', toolCalls: [] }),
      isReady: jest.fn().mockResolvedValue({ ok: true, model: '@cf/openai/gpt-oss-120b' }),
    };
    settings = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    service = new LlmService(
      { get: () => 'lmstudio' } as never,
      ollama as unknown as OllamaProvider,
      claude as unknown as ClaudeProvider,
      groq as unknown as GroqProvider,
      gemini as unknown as GeminiProvider,
      openrouter as unknown as OpenRouterProvider,
      xai as unknown as XaiProvider,
      cloudflare as unknown as CloudflareProvider,
      lmstudio as unknown as LmStudioProvider,
      ensureLlm as unknown as EnsureLlmService,
      settings as never,
    );
  });

  it('skips ensure when the active provider is already ready', async () => {
    lmstudio.isReady.mockResolvedValue({ ok: true, model: 'qwen/qwen3.5-9b' });

    await service.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(ensureLlm.ensureReady).not.toHaveBeenCalled();
    expect(lmstudio.chat).toHaveBeenCalled();
  });

  it('auto-starts a local runtime and switches provider when offline', async () => {
    lmstudio.isReady.mockResolvedValue({ ok: false, error: 'fetch failed' });
    ensureLlm.ensureReady.mockResolvedValue({
      ok: true,
      provider: 'ollama',
      model: 'llama3.2',
    });

    await service.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(ensureLlm.ensureReady).toHaveBeenCalledWith('lmstudio');
    expect(service.name).toBe('ollama');
    expect(ollama.chat).toHaveBeenCalled();
  });

  it('throws a clear error when no runtime can be started', async () => {
    lmstudio.isReady.mockResolvedValue({ ok: false, error: 'fetch failed' });
    ensureLlm.ensureReady.mockResolvedValue({
      ok: false,
      error: 'No local LLM is available.',
    });

    await expect(service.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      /No local LLM/,
    );
  });

  it('falls back from groq to gemini on rate limit', async () => {
    process.env.VERCEL = '1';
    process.env.JARVIS_SERVERLESS = '1';
    process.env.GEMINI_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    service.setProvider('groq');
    groq.chat.mockRejectedValue(
      new Error('Groq request failed (429): tokens per minute (TPM): Limit 8000'),
    );

    await service.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(gemini.chat).toHaveBeenCalled();
  });

  it('falls back from groq to gemini when groq returns an empty reply', async () => {
    process.env.VERCEL = '1';
    process.env.JARVIS_SERVERLESS = '1';
    process.env.GEMINI_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    service.setProvider('groq');
    groq.chat.mockResolvedValue({ content: '', toolCalls: [] });
    gemini.chat.mockResolvedValue({ content: 'At your service, sir.', toolCalls: [] });

    const result = await service.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(groq.chat).toHaveBeenCalled();
    expect(gemini.chat).toHaveBeenCalled();
    expect(result.content).toContain('At your service');
  });

  it('falls back from openrouter to gemini when daily free quota is exhausted', async () => {
    process.env.VERCEL = '1';
    process.env.JARVIS_SERVERLESS = '1';
    process.env.GEMINI_API_KEY = 'g';
    process.env.OPENROUTER_API_KEY = 'o';
    delete process.env.GROQ_API_KEY;
    service.setProvider('openrouter');
    openrouter.chat.mockRejectedValue(
      new Error(
        'OpenRouter request failed (429): {"error":{"message":"Rate limit exceeded: free-models-per-day"}}',
      ),
    );

    await service.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(gemini.chat).toHaveBeenCalled();
  });

  it('lets a manually selected provider override task-routing on every subsequent call', async () => {
    process.env.VERCEL = '1';
    process.env.JARVIS_SERVERLESS = '1';
    process.env.GEMINI_API_KEY = 'g';
    process.env.CLOUDFLARE_API_TOKEN = 'c';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    await service.setManualProvider('cloudflare');
    cloudflare.chat.mockResolvedValue({ content: 'from cloudflare', toolCalls: [] });

    const result = await service.chat({
      messages: [{ role: 'user', content: 'hi' }],
      route: { provider: 'gemini' },
    });

    expect(cloudflare.chat).toHaveBeenCalled();
    expect(gemini.chat).not.toHaveBeenCalled();
    expect(result.content).toContain('from cloudflare');
  });

  it('still auto-fails-over away from a manually selected provider when it errors', async () => {
    process.env.VERCEL = '1';
    process.env.JARVIS_SERVERLESS = '1';
    process.env.GEMINI_API_KEY = 'g';
    process.env.CLOUDFLARE_API_TOKEN = 'c';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    await service.setManualProvider('cloudflare');
    cloudflare.chat.mockRejectedValue(new Error('Cloudflare request failed (503): overloaded'));
    gemini.chat.mockResolvedValue({ content: 'from gemini', toolCalls: [] });

    const result = await service.chat({
      messages: [{ role: 'user', content: 'hi' }],
      route: { provider: 'gemini' },
    });

    expect(cloudflare.chat).toHaveBeenCalled();
    expect(gemini.chat).toHaveBeenCalled();
    expect(result.content).toContain('from gemini');
  });

  it('persists a manual selection to the database, not just in-memory', async () => {
    await service.setManualProvider('cloudflare');

    expect(settings.upsert).toHaveBeenCalledWith(
      { key: 'manual_provider', value: 'cloudflare' },
      ['key'],
    );
  });

  it('picks up a manual selection persisted by a different serverless instance', async () => {
    // Simulates a fresh cold start: this instance never called setManualProvider() itself, but
    // the database already has a value from a previous instance/request.
    process.env.VERCEL = '1';
    process.env.JARVIS_SERVERLESS = '1';
    process.env.GEMINI_API_KEY = 'g';
    process.env.CLOUDFLARE_API_TOKEN = 'c';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    settings.findOne.mockResolvedValue({ key: 'manual_provider', value: 'cloudflare' });
    cloudflare.chat.mockResolvedValue({ content: 'from cloudflare', toolCalls: [] });

    const result = await service.chat({
      messages: [{ role: 'user', content: 'hi' }],
      route: { provider: 'gemini' },
    });

    expect(settings.findOne).toHaveBeenCalledWith({ where: { key: 'manual_provider' } });
    expect(cloudflare.chat).toHaveBeenCalled();
    expect(gemini.chat).not.toHaveBeenCalled();
    expect(result.content).toContain('from cloudflare');
  });
});
