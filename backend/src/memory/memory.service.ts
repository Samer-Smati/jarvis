import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrainPgStore } from '../brain/brain-pg.store';
import { EmbeddingService } from '../llm/embedding.service';
import { ChatMessage } from '../llm/llm.types';
import { ConversationBlobStore } from './conversation-blob.store';
import { ConversationMessageEntity } from './entities/conversation-message.entity';
import { EpisodicEventEntity } from './entities/episodic-event.entity';
import { SemanticMemoryEntity } from './entities/semantic-memory.entity';

/** Max messages sent to the LLM per turn (full history stays in storage). */
const MAX_LLM_HISTORY =
  process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1' ? 30 : 200;

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly blob = new ConversationBlobStore();
  private readonly isServerless = !!(process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1');

  constructor(
    @InjectRepository(ConversationMessageEntity)
    private readonly messages: Repository<ConversationMessageEntity>,
    @InjectRepository(EpisodicEventEntity)
    private readonly events: Repository<EpisodicEventEntity>,
    @InjectRepository(SemanticMemoryEntity)
    private readonly semantic: Repository<SemanticMemoryEntity>,
    private readonly embeddings: EmbeddingService,
    private readonly brainPg: BrainPgStore,
  ) {}

  private useBlobForConversations(): boolean {
    return this.isServerless && this.blob.enabled();
  }

  // --- Tier 1: working memory (conversation turns) ---

  async appendMessage(conversationId: string, role: string, content: string): Promise<void> {
    if (this.useBlobForConversations()) {
      await this.blob.append(conversationId, role, content);
      return;
    }
    await this.messages.save(this.messages.create({ conversationId, role, content }));
  }

  async replaceConversation(
    conversationId: string,
    items: Array<{ role: string; content: string; createdAt?: string }>,
  ): Promise<number> {
    const dialog = items.filter((m) => m.role === 'user' || m.role === 'assistant');
    if (this.useBlobForConversations()) {
      await this.blob.replace(conversationId, dialog);
      return dialog.length;
    }
    await this.messages.delete({ conversationId });
    for (const item of dialog) {
      const row = this.messages.create({
        conversationId,
        role: item.role,
        content: item.content,
      });
      if (item.createdAt) {
        row.createdAt = new Date(item.createdAt);
      }
      await this.messages.save(row);
    }
    return dialog.length;
  }

  async loadConversation(conversationId: string): Promise<{ messages: ChatMessage[]; truncated: number }> {
    const rows = await this.listConversationMessages(conversationId);
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
    if (this.useBlobForConversations()) {
      const rows = await this.blob.load(conversationId);
      return rows.map((row) => {
        const entity = new ConversationMessageEntity();
        entity.id = row.id;
        entity.conversationId = row.conversationId;
        entity.role = row.role;
        entity.content = row.content;
        entity.createdAt = new Date(row.createdAt);
        return entity;
      });
    }
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
    void this.brainPg.indexChunk(text, 'fact');
    this.logger.log(`Remembered fact: ${text}`);
  }

  async recallFacts(query: string, limit = 5): Promise<string[]> {
    const pgHits = await this.brainPg.searchSimilar(query, limit);
    if (pgHits.length) {
      return pgHits.map((h) => h.text.slice(0, 320));
    }

    const all = await this.semantic.find();
    if (!all.length) {
      return [];
    }
    const queryVector = await this.embeddings.tryEmbed(query);
    if (!queryVector) {
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
