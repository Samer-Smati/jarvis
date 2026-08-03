import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CreateProjectInput, MemoryType, RememberTypedInput } from './memory.types';
import { SemanticMemoryEntity } from './entities/semantic-memory.entity';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { UserProjectEntity } from './entities/user-project.entity';

@Injectable()
export class MemoryRepository {
  constructor(
    @InjectRepository(SemanticMemoryEntity)
    private readonly semantic: Repository<SemanticMemoryEntity>,
    @InjectRepository(UserPreferenceEntity)
    private readonly preferences: Repository<UserPreferenceEntity>,
    @InjectRepository(UserProjectEntity)
    private readonly projects: Repository<UserProjectEntity>,
  ) {}

  async createFact(input: RememberTypedInput, embedding?: string): Promise<SemanticMemoryEntity> {
    // Check for existing fact with same text, memoryType, and source to avoid duplicates
    const existing = await this.semantic.findOne({
      where: {
        text: input.text,
        memoryType: input.memoryType,
        source: input.source,
        forgottenAt: IsNull(),
      },
    });

    if (existing) {
      // Update existing row instead of creating duplicate
      existing.confidence = input.confidence ?? existing.confidence;
      existing.pinned = input.pinned ?? existing.pinned;
      existing.lastVerified = new Date();
      if (embedding) {
        existing.embedding = embedding;
      }
      return this.semantic.save(existing);
    }

    const row = this.semantic.create({
      text: input.text,
      memoryType: input.memoryType,
      source: input.source,
      confidence: input.confidence ?? 1,
      pinned: input.pinned ?? false,
      embedding,
      lastVerified: new Date(),
    });
    return this.semantic.save(row);
  }

  async upsertPreference(
    key: string,
    value: string,
    source?: string,
    pinned?: boolean,
  ): Promise<UserPreferenceEntity> {
    const existing = await this.preferences.findOne({ where: { key, forgottenAt: IsNull() } });
    if (existing) {
      existing.value = value;
      existing.source = source ?? existing.source;
      if (pinned != null) {
        existing.pinned = pinned;
      }
      return this.preferences.save(existing);
    }
    return this.preferences.save(
      this.preferences.create({ key, value, source, pinned: pinned ?? false }),
    );
  }

  async getPreferenceValue(key: string): Promise<string | null> {
    const existing = await this.preferences.findOne({ where: { key, forgottenAt: IsNull() } });
    return existing?.value ?? null;
  }

  async createProject(input: CreateProjectInput): Promise<UserProjectEntity> {
    return this.projects.save(
      this.projects.create({
        name: input.name,
        description: input.description,
        status: input.status ?? 'active',
        tags: input.tags?.join(', '),
      }),
    );
  }

  async listActiveFacts(limit = 50): Promise<SemanticMemoryEntity[]> {
    return this.semantic.find({
      where: { forgottenAt: IsNull() },
      order: { pinned: 'DESC', updatedAt: 'DESC' },
      take: limit,
    });
  }

  async listActivePreferences(limit = 30): Promise<UserPreferenceEntity[]> {
    return this.preferences.find({
      where: { forgottenAt: IsNull() },
      order: { pinned: 'DESC', updatedAt: 'DESC' },
      take: limit,
    });
  }

  async listActiveProjects(limit = 20): Promise<UserProjectEntity[]> {
    return this.projects.find({
      where: { forgottenAt: IsNull(), status: 'active' },
      order: { pinned: 'DESC', updatedAt: 'DESC' },
      take: limit,
    });
  }

  async pinFact(id: string, pinned: boolean): Promise<SemanticMemoryEntity | null> {
    const row = await this.semantic.findOne({ where: { id } });
    if (!row) {
      return null;
    }
    row.pinned = pinned;
    return this.semantic.save(row);
  }

  async forgetFact(id: string): Promise<boolean> {
    const result = await this.semantic.update({ id }, { forgottenAt: new Date() });
    return (result.affected ?? 0) > 0;
  }

  async forgetPreference(id: string): Promise<boolean> {
    const result = await this.preferences.update({ id }, { forgottenAt: new Date() });
    return (result.affected ?? 0) > 0;
  }

  async forgetProject(id: string): Promise<boolean> {
    const result = await this.projects.update({ id }, { forgottenAt: new Date(), status: 'archived' });
    return (result.affected ?? 0) > 0;
  }

  async findFactsByType(type: MemoryType, limit = 8): Promise<SemanticMemoryEntity[]> {
    return this.semantic.find({
      where: { memoryType: type, forgottenAt: IsNull() },
      order: { pinned: 'DESC', updatedAt: 'DESC' },
      take: limit,
    });
  }

  async findPinnedFacts(limit = 8): Promise<SemanticMemoryEntity[]> {
    return this.semantic.find({
      where: { pinned: true, forgottenAt: IsNull() },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }

  async listForgottenFactTexts(): Promise<Set<string>> {
    const forgotten = await this.semantic
      .createQueryBuilder('m')
      .where('m.forgottenAt IS NOT NULL')
      .getMany();
    return new Set(forgotten.map((f) => f.text.trim().toLowerCase()));
  }

  async pruneStaleFacts(maxAgeDays = 90, minConfidence = 0.3): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);
    const candidates = await this.semantic
      .createQueryBuilder('m')
      .where('m.forgottenAt IS NULL')
      .andWhere('m.pinned = :pinned', { pinned: false })
      .andWhere('m.confidence < :minConfidence', { minConfidence })
      .andWhere('m.updatedAt < :cutoff', { cutoff })
      .getMany();

    let pruned = 0;
    for (const row of candidates) {
      row.forgottenAt = new Date();
      await this.semantic.save(row);
      pruned += 1;
    }
    return pruned;
  }
}
