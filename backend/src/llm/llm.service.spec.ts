import { EnsureLlmService } from './ensure-llm.service';
import { LlmService } from './llm.service';
import { ClaudeProvider } from './claude.provider';
import { GroqProvider } from './groq.provider';
import { LmStudioProvider } from './lmstudio.provider';
import { OllamaProvider } from './ollama.provider';

describe('LlmService ensureLocalRuntime', () => {
  let ensureLlm: jest.Mocked<Pick<EnsureLlmService, 'ensureReady'>>;
  let lmstudio: jest.Mocked<Pick<LmStudioProvider, 'name' | 'chat' | 'isReady'>>;
  let ollama: jest.Mocked<Pick<OllamaProvider, 'name' | 'chat' | 'isReady'>>;
  let claude: jest.Mocked<Pick<ClaudeProvider, 'name' | 'chat'>>;
  let groq: jest.Mocked<Pick<GroqProvider, 'name' | 'chat' | 'isReady'>>;
  let service: LlmService;

  beforeEach(() => {
    process.env.JARVIS_LLM_ENSURE = 'full';
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
    service = new LlmService(
      { get: () => 'lmstudio' } as never,
      ollama as unknown as OllamaProvider,
      claude as unknown as ClaudeProvider,
      groq as unknown as GroqProvider,
      lmstudio as unknown as LmStudioProvider,
      ensureLlm as unknown as EnsureLlmService,
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
});
