import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmbeddingService } from '../llm/embedding.service';
import { ChatMessage } from '../llm/llm.types';
import { ConversationMessageEntity } from './entities/conversation-message.entity';
import { EpisodicEventEntity } from './entities/episodic-event.entity';
import { SemanticMemoryEntity } from './entities/semantic-memory.entity';

/** Max messages sent to the LLM per turn (full history stays in SQLite). */
const MAX_LLM_HISTORY = 200;

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    @InjectRepository(ConversationMessageEntity)
    private readonly messages: Repository<ConversationMessageEntity>,
    @InjectRepository(EpisodicEventEntity)
    private readonly events: Repository<EpisodicEventEntity>,
    @InjectRepository(SemanticMemoryEntity)
    private readonly semantic: Repository<SemanticMemoryEntity>,
    private readonly embeddings: EmbeddingService,
  ) {}

  // --- Tier 1: working memory (conversation turns) ---

  async appendMessage(conversationId: string, role: string, content: string): Promise<void> {
    await this.messages.save(this.messages.create({ conversationId, role, content }));
  }

  async loadConversation(conversationId: string): Promise<{ messages: ChatMessage[]; truncated: number }> {
    const rows = await this.messages.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
    const dialog = rows.filter((r) => r.role === 'user' || r.role === 'assistant');
    const truncated = Math.max(0, dialog.length - MAX_LLM_HISTORY);
    const slice = truncated ? dialog.slice(-MAX_LLM_HISTORY) : dialog;
    const messages = slice.map((row) => ({
      role: row.role as ChatMessage['role'],
      content: `[${formatMessageTimestamp(row.createdAt)}] ${row.content}`,
    }));
    return { messages, truncated };
  }

  async listConversationMessages(conversationId: string): Promise<ConversationMessageEntity[]> {
    return this.messages.find({ where: { conversationId }, order: { createdAt: 'ASC' } });
  }

  // --- Tier 2: episodic memory (event log) ---

  async logEvent(kind: string, summary: string, detail?: string): Promise<void> {
    await this.events.save(this.events.create({ kind, summary, detail }));
  }

  async recentEvents(limit = 20): Promise<EpisodicEventEntity[]> {
    return this.events.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  // --- Tier 3: semantic memory (facts, embeddings) ---

  async rememberFact(text: string): Promise<void> {
    const vector = await this.embeddings.tryEmbed(text);
    await this.semantic.save(
      this.semantic.create({ text, embedding: vector ? JSON.stringify(vector) : undefined }),
    );
    this.logger.log(`Remembered fact: ${text}`);
  }

  async recallFacts(query: string, limit = 5): Promise<string[]> {
    const all = await this.semantic.find();
    if (!all.length) {
      return [];
    }
    const queryVector = await this.embeddings.tryEmbed(query);
    if (!queryVector) {
      // Embeddings unavailable — fall back to most recent facts.
      return all.slice(-limit).map((f) => f.text);
    }
    const scored = all
      .filter((f) => f.embedding)
      .map((f) => ({
        text: f.text,
        score: cosineSimilarity(queryVector, JSON.parse(f.embedding as string) as number[]),
      }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.text);
  }

  async listFacts(): Promise<SemanticMemoryEntity[]> {
    return this.semantic.find({ order: { createdAt: 'DESC' } });
  }
}

function formatMessageTimestamp(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
