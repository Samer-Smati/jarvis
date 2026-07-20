import { EnsureLlmService } from './ensure-llm.service';
import { LmStudioProvider } from './lmstudio.provider';
import { OllamaProvider } from './ollama.provider';

describe('EnsureLlmService', () => {
  let lmstudio: jest.Mocked<Pick<LmStudioProvider, 'isReady' | 'setPreferredModel'>>;
  let ollama: jest.Mocked<Pick<OllamaProvider, 'isReady'>>;
  let service: EnsureLlmService;

  beforeEach(() => {
    process.env.JARVIS_LLM_ENSURE = 'full';
    lmstudio = {
      isReady: jest.fn(),
      setPreferredModel: jest.fn(),
    };
    ollama = {
      isReady: jest.fn(),
    };
    service = new EnsureLlmService(
      {
        get: (key: string) => {
          if (key === 'LMSTUDIO_CHAT_MODEL') {
            return 'qwen/qwen3.5-9b';
          }
          if (key === 'OLLAMA_CHAT_MODEL') {
            return 'llama3.2';
          }
          return undefined;
        },
      } as never,
      lmstudio as unknown as LmStudioProvider,
      ollama as unknown as OllamaProvider,
    );
  });

  it('returns immediately when LM Studio is already ready', async () => {
    lmstudio.isReady.mockResolvedValue({ ok: true, model: 'qwen/qwen3.5-9b' });

    const result = await service.ensureReady('lmstudio');

    expect(result).toEqual({ ok: true, provider: 'lmstudio', model: 'qwen/qwen3.5-9b' });
    expect(ollama.isReady).not.toHaveBeenCalled();
  });

  it('falls back to Ollama when LM Studio cannot start', async () => {
    lmstudio.isReady.mockResolvedValue({ ok: false, error: 'offline' });
    ollama.isReady.mockResolvedValue({ ok: true, model: 'llama3.2' });
    jest.spyOn(service as never, 'hasCommand').mockResolvedValue(false as never);

    const result = await service.ensureReady('lmstudio');

    expect(result).toEqual({ ok: true, provider: 'ollama', model: 'llama3.2' });
  });

  it('reports failure when no local runtime is available', async () => {
    lmstudio.isReady.mockResolvedValue({ ok: false, error: 'offline' });
    ollama.isReady.mockResolvedValue({ ok: false, error: 'offline' });
    jest.spyOn(service as never, 'hasCommand').mockResolvedValue(false as never);

    const result = await service.ensureReady('lmstudio');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No local LLM/i);
  });
});
