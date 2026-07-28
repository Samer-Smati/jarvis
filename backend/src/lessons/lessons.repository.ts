import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LessonEntity } from './entities/lesson.entity';
import type { LessonDraft, LessonStatus } from './lessons.types';

@Injectable()
export class LessonsRepository {
  constructor(
    @InjectRepository(LessonEntity)
    private readonly lessons: Repository<LessonEntity>,
  ) {}

  async create(draft: LessonDraft, embedding?: string): Promise<LessonEntity> {
    return this.lessons.save(
      this.lessons.create({
        taskType: draft.taskType,
        triggerContext: draft.triggerContext,
        lessonText: draft.lessonText,
        confidenceScore: draft.confidenceScore,
        sourceInteractionId: draft.sourceInteractionId,
        status: draft.status ?? 'active',
        embedding,
      }),
    );
  }

  async findById(id: string): Promise<LessonEntity | null> {
    return this.lessons.findOne({ where: { id } });
  }

  async findBySourceInteractionId(sourceInteractionId: string): Promise<LessonEntity | null> {
    return this.lessons.findOne({ where: { sourceInteractionId } });
  }

  async findByBootstrapKey(key: string): Promise<LessonEntity | null> {
    return this.lessons.findOne({ where: { triggerContext: `bootstrap:${key}` } });
  }

  async listForReview(): Promise<LessonEntity[]> {
    return this.lessons.find({
      where: { status: In(['active', 'needs_review']) },
      order: { taskType: 'ASC', pinned: 'DESC', updatedAt: 'DESC' },
    });
  }

  async listActiveForTask(taskType: string): Promise<LessonEntity[]> {
    return this.lessons.find({
      where: { status: 'active', taskType },
      order: { pinned: 'DESC', reinforcementCount: 'DESC', updatedAt: 'DESC' },
    });
  }

  async listAllActive(): Promise<LessonEntity[]> {
    return this.lessons.find({
      where: { status: 'active' },
      order: { taskType: 'ASC', pinned: 'DESC', updatedAt: 'DESC' },
    });
  }

  async mergeInto(existing: LessonEntity): Promise<LessonEntity> {
    existing.reinforcementCount += 1;
    existing.updatedAt = new Date();
    return this.lessons.save(existing);
  }

  async updateLessonText(id: string, lessonText: string): Promise<LessonEntity | null> {
    const row = await this.findById(id);
    if (!row) {
      return null;
    }
    row.lessonText = lessonText;
    return this.lessons.save(row);
  }

  async saveEntity(entity: LessonEntity): Promise<LessonEntity> {
    return this.lessons.save(entity);
  }

  async setPinned(id: string, pinned: boolean): Promise<LessonEntity | null> {
    const row = await this.findById(id);
    if (!row) {
      return null;
    }
    row.pinned = pinned;
    return this.lessons.save(row);
  }

  async setStatus(id: string, status: LessonStatus): Promise<LessonEntity | null> {
    const row = await this.findById(id);
    if (!row) {
      return null;
    }
    row.status = status;
    return this.lessons.save(row);
  }

  async recordRetrieval(ids: string[]): Promise<void> {
    if (!ids.length) {
      return;
    }
    await this.lessons
      .createQueryBuilder()
      .update(LessonEntity)
      .set({
        retrievalCount: () => 'retrievalCount + 1',
        lastUsedAt: new Date(),
      })
      .whereInIds(ids)
      .execute();
  }

  async findArchiveCandidates(staleDays: number): Promise<LessonEntity[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleDays);
    return this.lessons
      .createQueryBuilder('l')
      .where('l.status = :status', { status: 'active' })
      .andWhere('l.pinned = :pinned', { pinned: false })
      .andWhere('l.reinforcementCount <= 1')
      .andWhere('l.retrievalCount = 0')
      .andWhere('(l.lastUsedAt IS NULL OR l.lastUsedAt < :cutoff)', { cutoff })
      .andWhere('l.createdAt < :cutoff', { cutoff })
      .getMany();
  }

  async archiveIds(ids: string[]): Promise<number> {
    if (!ids.length) {
      return 0;
    }
    const result = await this.lessons.update({ id: In(ids) }, { status: 'archived' });
    return result.affected ?? 0;
  }
}
