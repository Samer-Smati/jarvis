import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { BrainPgStore } from '../brain/brain-pg.store';
import { EmbeddingService } from '../llm/embedding.service';
import { ChatMessage } from '../llm/llm.types';
import { ConversationBlobStore } from './conversation-blob.store';
import { ConversationMessageEntity } from './entities/conversation-message.entity';
import { EpisodicEventEntity } from './entities/episodic-event.entity';
import { SemanticMemoryEntity } from './entities/semantic-memory.entity';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { UserProjectEntity } from './entities/user-project.entity';
import { MemoryRepository } from './memory.repository';
import { CreateProjectInput, MemoryContextBlock, RememberTypedInput } from './memory.types';
import { LessonsService } from '../lessons/lessons.service';
import { filterFactMemoryHits, filterStaleMemoryHits } from './memory-hit-filter.util';

export interface RememberFactResult {
  preferenceRows: Array<{ id: string; key: string; value: string }>;
  semanticRows: Array<{ id: string; text: string; memoryType: string }>;
  brainPath?: string;
}

const MAX_LLM_HISTORY =
  process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1' ? 30 : 200;
const MAX_CONTEXT_CHUNKS = 8;

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
    @InjectRepository(UserPreferenceEntity)
    private readonly preferences: Repository<UserPreferenceEntity>,
    @InjectRepository(UserProjectEntity)
    private readonly projects: Repository<UserProjectEntity>,
    private readonly embeddings: EmbeddingService,
    private readonly brainPg: BrainPgStore,
    private readonly repository: MemoryRepository,
    private readonly lessons: LessonsService,
  ) {}

  private useBlobForConversations(): boolean {
    return this.isServerless && this.blob.enabled();
  }

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

  async logEvent(kind: string, summary: string, detail?: string): Promise<void> {
    await this.events.save(this.events.create({ kind, summary, detail }));
  }

  async recentEvents(limit = 20): Promise<EpisodicEventEntity[]> {
    return this.events.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  async rememberFact(text: string): Promise<RememberFactResult> {
    return this.rememberFactDetailed({ text });
  }

  async rememberFactDetailed(input: {
    text: string;
    key?: string;
    preferences?: Array<{ key: string; value: string }>;
    source?: string;
  }): Promise<RememberFactResult> {
    const trimmed = input.text.trim();
    if (!trimmed) {
      throw new Error('Memory text is required.');
    }

    const source = input.source ?? 'remember_fact';
    const preferenceWrites =
      input.preferences?.length
        ? input.preferences
        : input.key
          ? [{ key: input.key, value: trimmed }]
          : [];

    const preferenceRows: RememberFactResult['preferenceRows'] = [];
    const semanticRows: RememberFactResult['semanticRows'] = [];

    if (preferenceWrites.length) {
      for (const pref of preferenceWrites) {
        const prefRow = await this.repository.upsertPreference(
          pref.key,
          pref.value,
          source,
          true,
        );
        preferenceRows.push({ id: prefRow.id, key: prefRow.key, value: prefRow.value });
        const vector = await this.embeddings.tryEmbed(`${pref.key}: ${pref.value}`);
        const factRow = await this.repository.createFact(
          {
            text: `${pref.key}: ${pref.value}`,
            memoryType: 'preference',
            source,
            key: pref.key,
            pinned: true,
          },
          vector ? JSON.stringify(vector) : undefined,
        );
        semanticRows.push({ id: factRow.id, text: factRow.text, memoryType: factRow.memoryType });
        void this.brainPg.indexChunk(`${pref.key}: ${pref.value}`, 'preference');
      }
      this.logger.log(
        `Remembered ${preferenceWrites.length} preference(s) via remember_fact`,
      );
      return { preferenceRows, semanticRows };
    }

    const vector = await this.embeddings.tryEmbed(trimmed);
    const row = await this.repository.createFact(
      { text: trimmed, memoryType: 'fact', source },
      vector ? JSON.stringify(vector) : undefined,
    );
    void this.brainPg.indexChunk(trimmed, 'fact');
    this.logger.log(`Remembered fact: ${trimmed.slice(0, 80)}`);
    return {
      preferenceRows: [],
      semanticRows: [{ id: row.id, text: row.text, memoryType: row.memoryType }],
    };
  }

  async rememberTyped(input: RememberTypedInput): Promise<SemanticMemoryEntity | UserProjectEntity> {
    const trimmed = input.text.trim();
    if (!trimmed) {
      throw new Error('Memory text is required.');
    }

    if (input.memoryType === 'preference' && input.key) {
      await this.repository.upsertPreference(input.key, trimmed, input.source, input.pinned);
      const vector = await this.embeddings.tryEmbed(`${input.key}: ${trimmed}`);
      return this.repository.createFact(
        { ...input, text: `${input.key}: ${trimmed}` },
        vector ? JSON.stringify(vector) : undefined,
      );
    }

    if (input.memoryType === 'project') {
      return this.rememberProject({ name: trimmed, description: input.source });
    }

    const vector = await this.embeddings.tryEmbed(trimmed);
    const row = await this.repository.createFact(input, vector ? JSON.stringify(vector) : undefined);
    void this.brainPg.indexChunk(trimmed, 'fact');
    this.logger.log(`Remembered ${input.memoryType}: ${trimmed.slice(0, 80)}`);
    return row;
  }

  async rememberProject(input: CreateProjectInput): Promise<UserProjectEntity> {
    const project = await this.repository.createProject(input);
    const summary = `Project: ${input.name}${input.description ? ` — ${input.description}` : ''}`;
    void this.brainPg.indexChunk(summary, 'project');
    return project;
  }

  async buildContext(query: string, taskType?: string): Promise<MemoryContextBlock> {
    const forgotten = await this.repository.listForgottenFactTexts();
    const filterForgotten = (items: string[]) =>
      items.filter((t) => !forgotten.has(t.trim().toLowerCase()));

    const [factsRaw, prefs, projects, pgHits, lessonCtx] = await Promise.all([
      this.recallFacts(query, MAX_CONTEXT_CHUNKS),
      this.repository.listActivePreferences(6),
      this.repository.listActiveProjects(4),
      this.brainPg.searchSimilar(query, MAX_CONTEXT_CHUNKS),
      this.lessons.findRelevantLessons(query, taskType),
    ]);

    const pinnedFacts = await this.repository.findPinnedFacts(4);
    const pinnedPrefs = prefs.filter((p) => p.pinned);
    const dedupedHits = filterStaleMemoryHits(
      filterForgotten(
        dedupeStrings([...factsRaw, ...pgHits.map((h) => h.text.slice(0, 320))]),
      ),
    ).slice(0, MAX_CONTEXT_CHUNKS);

    return {
      facts: filterForgotten(
        dedupeStrings([...pinnedFacts.map((f) => f.text), ...factsRaw]),
      ).slice(0, MAX_CONTEXT_CHUNKS),
      preferences: [
        ...pinnedPrefs.map((p) => `${p.key}: ${p.value}`),
        ...prefs.filter((p) => !p.pinned).map((p) => `${p.key}: ${p.value}`),
      ].slice(0, 6),
      projects: projects.map((p) =>
        p.description ? `${p.name} (${p.status}): ${p.description}` : `${p.name} (${p.status})`,
      ),
      conversationHits: dedupedHits,
      lessons: lessonCtx.texts,
      lessonIds: lessonCtx.ids,
    };
  }

  async pruneStaleMemories(maxAgeDays = 90): Promise<number> {
    const pruned = await this.repository.pruneStaleFacts(maxAgeDays);
    if (pruned > 0) {
      this.logger.log(`Memory prune: marked ${pruned} stale facts as forgotten (pinned untouched).`);
    }
    return pruned;
  }

  async indexConversationTurn(userText: string, assistantText: string, journalPath?: string): Promise<void> {
    await this.brainPg.indexTurn(userText, assistantText, journalPath);
  }

  async recallFacts(query: string, limit = 5): Promise<string[]> {
    const forgotten = await this.repository.listForgottenFactTexts();
    const filterForgotten = (items: string[]) =>
      items.filter((t) => !forgotten.has(t.trim().toLowerCase()));

    // Never treat indexed chat turns as durable "facts" (causes about-me echo bugs).
    const pgHits = await this.brainPg.searchSimilar(query, limit, {
      excludeSourceTypes: ['turn'],
    });
    if (pgHits.length) {
      return filterForgotten(filterFactMemoryHits(pgHits.map((h) => h.text.slice(0, 320))));
    }

    const all = await this.semantic.find({ where: { forgottenAt: IsNull() } });
    if (!all.length) {
      return [];
    }
    const queryVector = await this.embeddings.tryEmbed(query);
    if (!queryVector) {
      return filterForgotten(all.slice(-limit).map((f) => f.text));
    }
    const scored = all
      .filter((f) => f.embedding)
      .map((f) => ({
        text: f.text,
        score: cosineSimilarity(queryVector, JSON.parse(f.embedding as string) as number[]),
      }))
      .sort((a, b) => b.score - a.score);
    return filterForgotten(scored.slice(0, limit).map((s) => s.text));
  }

  async listFacts(): Promise<SemanticMemoryEntity[]> {
    return this.repository.listActiveFacts();
  }

  async listPreferences(): Promise<UserPreferenceEntity[]> {
    return this.repository.listActivePreferences();
  }

  async listProjects(): Promise<UserProjectEntity[]> {
    return this.repository.listActiveProjects();
  }

  async pinFact(id: string, pinned: boolean): Promise<SemanticMemoryEntity | null> {
    return this.repository.pinFact(id, pinned);
  }

  async forgetFact(id: string): Promise<{ ok: boolean }> {
    return { ok: await this.repository.forgetFact(id) };
  }

  async forgetPreference(id: string): Promise<{ ok: boolean }> {
    return { ok: await this.repository.forgetPreference(id) };
  }

  async forgetProject(id: string): Promise<{ ok: boolean }> {
    return { ok: await this.repository.forgetProject(id) };
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

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}
