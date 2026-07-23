import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isServerlessRuntime } from '../database/database.util';

/**
 * Text embeddings for semantic memory.
 * Cloud (Vercel): Gemini text-embedding-004 (free tier).
 * Desktop: Ollama or LM Studio local models.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly provider: string;
  private readonly ollamaUrl: string;
  private readonly ollamaModel: string;
  private readonly lmstudioUrl: string;
  private readonly lmstudioModel: string;
  private readonly geminiApiKey: string;
  private readonly geminiModel: string;

  constructor(config: ConfigService) {
    const llmProvider = config.get<string>('LLM_PROVIDER') ?? 'ollama';
    this.geminiApiKey = config.get<string>('GEMINI_API_KEY')?.trim() ?? '';
    this.geminiModel = config.get<string>('GEMINI_EMBED_MODEL') ?? 'text-embedding-004';
    this.provider =
      config.get<string>('EMBED_PROVIDER') ??
      (this.geminiApiKey && isServerlessRuntime()
        ? 'gemini'
        : llmProvider === 'lmstudio'
          ? 'lmstudio'
          : 'ollama');
    this.ollamaUrl = config.get<string>('OLLAMA_BASE_URL') ?? 'http://localhost:11434';
    this.ollamaModel = config.get<string>('OLLAMA_EMBED_MODEL') ?? 'nomic-embed-text';
    this.lmstudioUrl = (config.get<string>('LMSTUDIO_BASE_URL') ?? 'http://localhost:1234/v1').replace(/\/$/, '');
    this.lmstudioModel =
      config.get<string>('LMSTUDIO_EMBED_MODEL') ?? 'text-embedding-nomic-embed-text-v1.5';
  }

  async embed(text: string): Promise<number[]> {
    switch (this.provider) {
      case 'gemini':
        return this.embedGemini(text);
      case 'lmstudio':
        return this.embedLmStudio(text);
      case 'ollama':
        return this.embedOllama(text);
      default: {
        if (this.geminiApiKey) {
          return this.embedGemini(text);
        }
        return this.embedOllama(text);
      }
    }
  }

  async tryEmbed(text: string): Promise<number[] | null> {
    if (this.geminiApiKey) {
      try {
        return await this.embedGemini(text);
      } catch (error) {
        this.logger.warn(`Gemini embedding failed: ${(error as Error).message}`);
      }
    }

    if (isServerlessRuntime()) {
      return null;
    }

    try {
      return await this.embed(text);
    } catch (error) {
      this.logger.warn(`Embedding unavailable: ${(error as Error).message}`);
      return null;
    }
  }

  private async embedGemini(text: string): Promise<number[]> {
    if (!this.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not set.');
    }
    const model = this.geminiModel.startsWith('models/')
      ? this.geminiModel
      : `models/${this.geminiModel}`;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${model}:embedContent?key=${this.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 8000) }] },
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Gemini embedding failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as { embedding?: { values?: number[] } };
    const values = data.embedding?.values;
    if (!values?.length) {
      throw new Error('Gemini returned no embedding.');
    }
    return values;
  }

  private async embedOllama(text: string): Promise<number[]> {
    const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.ollamaModel, prompt: text }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ollama embedding failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  private async embedLmStudio(text: string): Promise<number[]> {
    const response = await fetch(`${this.lmstudioUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.lmstudioModel, input: text }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`LM Studio embedding failed (${response.status}): ${body}`);
    }
    const data = (await response.json()) as { data?: { embedding: number[] }[] };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) {
      throw new Error('LM Studio returned no embedding.');
    }
    return embedding;
  }
}
