import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrainPgStore } from '../brain/brain-pg.store';
import { redactSensitive } from '../feedback/feedback-redact.util';
import { InteractionLogEntity } from '../feedback/entities/interaction-log.entity';
import { EmbeddingService } from '../llm/embedding.service';
import { LlmService } from '../llm/llm.service';
import type { TaskType } from '../llm/task-router.service';
import { LessonEntity } from './entities/lesson.entity';
import { BOOTSTRAP_LESSONS } from './default-lessons';
import { LessonsRepository } from './lessons.repository';
import type {
  CreateDirectLessonInput,
  ExtractionResult,
  ContradictionResult,
  LessonDraft,
  MemoryLessonContext,
} from './lessons.types';

const EXTRACTION_SYSTEM = `You are a memory curator for a personal AI assistant named JARVIS.

Given a user interaction where the assistant's reply was wrong or unsatisfactory,
extract ONE short lesson — a single sentence the assistant should follow next time
in a similar situation.

Rules:
- Write the lesson as an imperative instruction to the assistant (not a summary of the chat).
- Focus on WHAT TO DO differently, not what went wrong.
- Do NOT include names, emails, API keys, or other PII.
- If the correction is too vague to form a useful rule, return confidence below 0.5.
- Maximum 220 characters for lesson_text.

Respond ONLY as JSON:
{
  "lesson_text": "...",
  "confidence_score": 0.0-1.0,
  "task_type_hint": "quick_qa|coding|reasoning|creative|tool_heavy|personal|general"
}`;

@Injectable()
export class LessonsService implements OnModuleInit {
  private readonly logger = new Logger(LessonsService.name);
  private readonly topN: number;
  private readonly minConfidence: number;
  private readonly mergeThreshold: number;
  private readonly staleDays: number;

  constructor(
    private readonly repository: LessonsRepository,
    private readonly embeddings: EmbeddingService,
    private readonly brainPg: BrainPgStore,
    private readonly llm: LlmService,
    config: ConfigService,
    @InjectRepository(InteractionLogEntity)
    private readonly interactions: Repository<InteractionLogEntity>,
  ) {
    this.topN = Number(config.get<string>('JARVIS_LESSONS_TOP_N') ?? 3);
    this.minConfidence = Number(config.get<string>('JARVIS_LESSONS_MIN_CONFIDENCE') ?? 0.55);
    this.mergeThreshold = Number(config.get<string>('JARVIS_LESSONS_MERGE_THRESHOLD') ?? 0.85);
    this.staleDays = Number(config.get<string>('JARVIS_LESSONS_STALE_DAYS') ?? 30);
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBootstrapLessons();
  }

  async ensureBootstrapLessons(): Promise<void> {
    for (const def of BOOTSTRAP_LESSONS) {
      const existing = await this.repository.findByBootstrapKey(def.key);
      if (existing) {
        continue;
      }
      const vector = await this.embeddings.tryEmbed(def.lessonText);
      const row = await this.repository.create(
        {
          taskType: def.taskType,
          triggerContext: `bootstrap:${def.key}`,
          lessonText: def.lessonText,
          confidenceScore: 1,
          status: 'active',
        },
        vector ? JSON.stringify(vector) : undefined,
      );
      row.pinned = true;
      row.reinforcementCount = 5;
      await this.repository.saveEntity(row);
      this.logger.log(`Bootstrap lesson [${def.taskType}]: ${def.key}`);
    }
  }

  async extractFromInteraction(interactionId: string): Promise<void> {
    try {
      const existing = await this.repository.findBySourceInteractionId(interactionId);
      if (existing) {
        this.logger.debug(`Lesson already exists for interaction ${interactionId}`);
        return;
      }

      const row = await this.interactions.findOne({ where: { id: interactionId } });
      if (!row) {
        return;
      }

      if ((row.rating ?? 5) > 2 && !row.correction?.trim()) {
        return;
      }

      const extracted = await this.runExtraction(row);
      if (!extracted || extracted.confidence_score < this.minConfidence) {
        this.logger.debug(`Lesson extraction skipped — low confidence for ${interactionId}`);
        return;
      }

      const taskType = this.normalizeTaskType(extracted.task_type_hint ?? row.taskRoute ?? 'general');
      await this.mergeOrCreate({
        taskType,
        triggerContext: redactSensitive(row.prompt.slice(0, 500)),
        lessonText: redactSensitive(extracted.lesson_text.slice(0, 220)),
        confidenceScore: extracted.confidence_score,
        sourceInteractionId: interactionId,
      });
    } catch (error) {
      this.logger.warn(`Lesson extraction failed for ${interactionId}: ${(error as Error).message}`);
    }
  }

  async createDirect(input: CreateDirectLessonInput): Promise<LessonEntity> {
    const lessonText = redactSensitive(input.lessonText.trim().slice(0, 220));
    const triggerContext = redactSensitive(input.triggerContext.slice(0, 500));
    return this.mergeOrCreate({
      taskType: this.normalizeTaskType(input.taskType ?? 'general'),
      triggerContext,
      lessonText,
      confidenceScore: 1,
      sourceInteractionId: input.sourceInteractionId,
      status: 'active',
    });
  }

  async mergeOrCreate(draft: LessonDraft): Promise<LessonEntity> {
    const vector = await this.embeddings.tryEmbed(draft.lessonText);
    const activeLessons = await this.repository.listActiveForTask(draft.taskType);
    let bestMatch: LessonEntity | null = null;
    let bestScore = 0;

    if (vector?.length) {
      for (const lesson of activeLessons) {
        if (!lesson.embedding) {
          continue;
        }
        const score = cosineSimilarity(vector, JSON.parse(lesson.embedding) as number[]);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = lesson;
        }
      }
    }

    if (bestMatch && bestScore >= this.mergeThreshold) {
      const contradicts = await this.judgeContradiction(bestMatch.lessonText, draft.lessonText);
      if (contradicts) {
        this.logger.warn(
          `Lesson contradiction flagged for task ${draft.taskType}: "${draft.lessonText.slice(0, 60)}"`,
        );
        return this.persistLesson({ ...draft, status: 'needs_review' }, vector ?? undefined);
      }
      return this.repository.mergeInto(bestMatch);
    }

    return this.persistLesson(draft, vector ?? undefined);
  }

  async findRelevantLessons(query: string, taskType?: string): Promise<MemoryLessonContext> {
    try {
      return await this.findRelevantLessonsInner(query, taskType);
    } catch (error) {
      this.logger.warn(`Lesson retrieval skipped: ${(error as Error).message}`);
      return { texts: [], ids: [] };
    }
  }

  private async findRelevantLessonsInner(query: string, taskType?: string): Promise<MemoryLessonContext> {
    const limit = this.topN;
    const candidates = await this.repository.listAllActive();
    const filtered = candidates.filter(
      (l) =>
        l.confidenceScore >= this.minConfidence &&
        (!taskType || l.taskType === taskType || l.taskType === 'general'),
    );

    const queryVector = await this.embeddings.tryEmbed(query.slice(0, 1500));
    let scored: Array<{ lesson: LessonEntity; score: number }> = [];

    if (queryVector?.length) {
      scored = filtered
        .filter((l) => l.embedding)
        .map((l) => ({
          lesson: l,
          score:
            cosineSimilarity(queryVector, JSON.parse(l.embedding as string) as number[]) +
            (l.pinned ? 0.12 : 0),
        }))
        .sort((a, b) => b.score - a.score);
    }

    if (!scored.length) {
      scored = filtered
        .slice(0, limit)
        .map((lesson) => ({ lesson, score: lesson.reinforcementCount }));
    }

    const top = scored.slice(0, limit);
    return {
      texts: top.map((t) => t.lesson.lessonText),
      ids: top.map((t) => t.lesson.id),
    };
  }

  async recordRetrieval(ids: string[]): Promise<void> {
    await this.repository.recordRetrieval(ids);
  }

  async listForReview(): Promise<LessonEntity[]> {
    return this.repository.listForReview();
  }

  async getById(id: string): Promise<LessonEntity | null> {
    return this.repository.findById(id);
  }

  async updateText(id: string, lessonText: string): Promise<LessonEntity | null> {
    const row = await this.repository.updateLessonText(id, redactSensitive(lessonText.slice(0, 220)));
    if (row) {
      const vector = await this.embeddings.tryEmbed(row.lessonText);
      if (vector) {
        row.embedding = JSON.stringify(vector);
        await this.repository.saveEntity(row);
        await this.brainPg.indexChunk(`Lesson: ${row.lessonText}`, 'lesson');
      }
    }
    return row;
  }

  async pin(id: string, pinned: boolean): Promise<LessonEntity | null> {
    return this.repository.setPinned(id, pinned);
  }

  async approve(id: string): Promise<LessonEntity | null> {
    const row = await this.repository.findById(id);
    if (!row || row.status !== 'needs_review') {
      return null;
    }
    return this.repository.setStatus(id, 'active');
  }

  async reject(id: string): Promise<LessonEntity | null> {
    const row = await this.repository.findById(id);
    if (!row || row.status !== 'needs_review') {
      return null;
    }
    return this.repository.setStatus(id, 'archived');
  }

  async archive(id: string): Promise<LessonEntity | null> {
    return this.repository.setStatus(id, 'archived');
  }

  async archiveStale(days = this.staleDays): Promise<number> {
    const candidates = await this.repository.findArchiveCandidates(days);
    const count = await this.repository.archiveIds(candidates.map((c) => c.id));
    if (count > 0) {
      this.logger.log(`Archived ${count} stale lessons (pinned untouched).`);
    }
    return count;
  }

  async pruneDryRun(days = this.staleDays): Promise<LessonEntity[]> {
    return this.repository.findArchiveCandidates(days);
  }

  private async persistLesson(draft: LessonDraft, vector?: number[]): Promise<LessonEntity> {
    const row = await this.repository.create(draft, vector ? JSON.stringify(vector) : undefined);
    void this.brainPg.indexChunk(`Lesson: ${draft.lessonText}`, 'lesson');
    this.logger.log(`Stored lesson [${draft.taskType}]: ${draft.lessonText.slice(0, 80)}`);
    return row;
  }

  private async runExtraction(row: InteractionLogEntity): Promise<ExtractionResult | null> {
    const correctionLine = row.correction?.trim()
      ? row.correction
      : '(none — infer from mismatch between user message and assistant reply)';

    const userContent = `--- Interaction ---
User message:
${row.prompt}

Assistant reply (wrong):
${row.response}

User correction (if any):
${correctionLine}`;

    try {
      const result = await this.llm.chat({
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM },
          { role: 'user', content: userContent },
        ],
      });
      const parsed = parseJsonFromLlm<ExtractionResult>(result.content);
      if (!parsed?.lesson_text?.trim()) {
        return null;
      }
      return parsed;
    } catch (error) {
      this.logger.warn(`LLM extraction error: ${(error as Error).message}`);
      return null;
    }
  }

  private async judgeContradiction(existing: string, incoming: string): Promise<boolean> {
    const prompt = `You judge whether two assistant lessons CONTRADICT each other for the same task type.

Lesson A: "${existing}"
Lesson B: "${incoming}"

Reply JSON only: { "contradicts": true|false, "reason": "..." }

Contradiction means following both could not be done simultaneously
(e.g. "always use weekly report" vs "always use monthly report" for the same trigger).
Mere rewordings or refinements are NOT contradictions.`;

    try {
      const result = await this.llm.chat({
        messages: [{ role: 'user', content: prompt }],
      });
      const parsed = parseJsonFromLlm<ContradictionResult>(result.content);
      return !!parsed?.contradicts;
    } catch (error) {
      this.logger.warn(`Contradiction judge failed: ${(error as Error).message}`);
      return false;
    }
  }

  private normalizeTaskType(raw: string): string {
    const t = raw.trim().toLowerCase();
    const allowed: TaskType[] = ['quick_qa', 'coding', 'reasoning', 'creative', 'tool_heavy', 'personal'];
    if (allowed.includes(t as TaskType)) {
      return t;
    }
    return 'general';
  }
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
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function parseJsonFromLlm<T>(content: string): T | null {
  const trimmed = content.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(jsonText.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
