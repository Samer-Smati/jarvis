import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Text embeddings for semantic memory. Uses LM Studio's OpenAI-compatible
 * /embeddings endpoint or Ollama, following the configured provider.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly provider: string;
  private readonly ollamaUrl: string;
  private readonly ollamaModel: string;
  private readonly lmstudioUrl: string;
  private readonly lmstudioModel: string;

  constructor(config: ConfigService) {
    const llmProvider = config.get<string>('LLM_PROVIDER') ?? 'ollama';
    this.provider =
      config.get<string>('EMBED_PROVIDER') ?? (llmProvider === 'lmstudio' ? 'lmstudio' : 'ollama');
    this.ollamaUrl = config.get<string>('OLLAMA_BASE_URL') ?? 'http://localhost:11434';
    this.ollamaModel = config.get<string>('OLLAMA_EMBED_MODEL') ?? 'nomic-embed-text';
    this.lmstudioUrl = (config.get<string>('LMSTUDIO_BASE_URL') ?? 'http://localhost:1234/v1').replace(/\/$/, '');
    this.lmstudioModel =
      config.get<string>('LMSTUDIO_EMBED_MODEL') ?? 'text-embedding-nomic-embed-text-v1.5';
  }

  async embed(text: string): Promise<number[]> {
    return this.provider === 'lmstudio' ? this.embedLmStudio(text) : this.embedOllama(text);
  }

  async tryEmbed(text: string): Promise<number[] | null> {
    try {
      return await this.embed(text);
    } catch (error) {
      this.logger.warn(`Embedding unavailable: ${(error as Error).message}`);
      return null;
    }
  }

  private async embedOllama(text: string): Promise<number[]> {
    const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.ollamaModel, prompt: text }),
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
