import { ConfigService } from '@nestjs/config';
import { cosineSimilarity, EmbeddingService } from './embedding.service';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for mismatched lengths or zero vectors', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('EmbeddingService Gemini embedding', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to gemini-embedding-001 and requests 768 dimensions for backward compatibility', async () => {
    // ConfigService falls back to process.env for keys missing from its constructor object, so
    // explicitly unset this rather than relying on the object alone — a real shell env var here
    // would otherwise silently shadow the default this test verifies.
    const previousEnvModel = process.env.GEMINI_EMBED_MODEL;
    delete process.env.GEMINI_EMBED_MODEL;

    const config = new ConfigService({
      GEMINI_API_KEY: 'k',
      EMBED_PROVIDER: 'gemini',
    });
    const service = new EmbeddingService(config);

    let capturedUrl = '';
    let capturedBody: { outputDimensionality?: number } = {};
    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String((init as RequestInit).body));
      return {
        ok: true,
        json: async () => ({ embedding: { values: new Array(768).fill(0.1) } }),
      } as Response;
    });

    try {
      const result = await service.embed('hello world');

      expect(capturedUrl).toContain('models/gemini-embedding-001:embedContent');
      expect(capturedBody.outputDimensionality).toBe(768);
      expect(result).toHaveLength(768);
    } finally {
      if (previousEnvModel === undefined) {
        delete process.env.GEMINI_EMBED_MODEL;
      } else {
        process.env.GEMINI_EMBED_MODEL = previousEnvModel;
      }
    }
  });
});
