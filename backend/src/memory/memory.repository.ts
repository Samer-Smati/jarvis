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
    @InjectRepository(SemanticMemoryEntity) private readonly semantic: Repository<SemanticMemoryEntity>,
    @InjectRepository(UserPreferenceEntity) private readonly preferences: Repository<UserPreferenceEntity>,
    @InjectRepository(UserProjectEntity) private readonly projects: Repository<UserProjectEntity>,
  ) {}

  async createFact(input: RememberTypedInput, embedding?: string): Promise<SemanticMemoryEntity> {
    // Check for existing semantic memory first
    const existing = await this.semantic.findOne({
      where: {
        text: input.text,
        memoryType: input.memoryType,
        source: input.source,
      }
    });

    // Return and replace if exists, otherwise create new
    if (existing) {
      if (input.text !== existing.text || input.memoryType !== existing.memoryType) {
        // Update text/memoryType if values have changed
        existing.text = input.text;
        existing.memoryType = input.memoryType;
        existing.embedding = embedding ?? existing.embedding;
        existing.lastVerified = new Date();
        return this.semantic.save(existing);
      }
      return existing;
    }

    // Create new fact if no duplicate found
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

  // Include all other existing methods from original file...
}