import { ConfigService } from '@nestjs/config';
import { LessonsService } from './lessons.service';
import { LessonsRepository } from './lessons.repository';
import { EmbeddingService } from '../llm/embedding.service';
import { BrainPgStore } from '../brain/brain-pg.store';
import { LlmService } from '../llm/llm.service';
import { LessonEntity } from './entities/lesson.entity';
import { InteractionLogEntity } from '../feedback/entities/interaction-log.entity';

describe('LessonsService', () => {
  let service: LessonsService;
  let repository: jest.Mocked<
    Pick<
      LessonsRepository,
      | 'create'
      | 'findBySourceInteractionId'
      | 'listActiveForTask'
      | 'listAllActive'
      | 'mergeInto'
      | 'findById'
      | 'setStatus'
      | 'findArchiveCandidates'
      | 'archiveIds'
      | 'findByBootstrapKey'
      | 'saveEntity'
    >
  >;
  let embeddings: { tryEmbed: jest.Mock };
  let brainPg: { indexChunk: jest.Mock };
  let llm: { chat: jest.Mock };
  let interactions: { findOne: jest.Mock };

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findBySourceInteractionId: jest.fn().mockResolvedValue(null),
      listActiveForTask: jest.fn().mockResolvedValue([]),
      listAllActive: jest.fn().mockResolvedValue([]),
      mergeInto: jest.fn(),
      findById: jest.fn(),
      setStatus: jest.fn(),
      findArchiveCandidates: jest.fn().mockResolvedValue([]),
      archiveIds: jest.fn().mockResolvedValue(0),
      findByBootstrapKey: jest.fn().mockResolvedValue(null),
      saveEntity: jest.fn().mockImplementation(async (row: LessonEntity) => row),
    };
    embeddings = {
      tryEmbed: jest.fn().mockResolvedValue([1, 0, 0]),
    };
    brainPg = {
      indexChunk: jest.fn().mockResolvedValue(undefined),
    };
    llm = {
      chat: jest.fn(),
    };
    interactions = {
      findOne: jest.fn(),
    };

    const config = {
      get: (key: string) => {
        const map: Record<string, string> = {
          JARVIS_LESSONS_TOP_N: '3',
          JARVIS_LESSONS_MIN_CONFIDENCE: '0.55',
          JARVIS_LESSONS_MERGE_THRESHOLD: '0.85',
          JARVIS_LESSONS_STALE_DAYS: '30',
        };
        return map[key];
      },
    };

    service = new LessonsService(
      repository as unknown as LessonsRepository,
      embeddings as unknown as EmbeddingService,
      brainPg as unknown as BrainPgStore,
      llm as unknown as LlmService,
      config as unknown as ConfigService,
      interactions as never,
    );
  });

  it('createDirect stores high-confidence lesson', async () => {
    const saved = { id: 'l1', lessonText: 'Use weekly report.' } as LessonEntity;
    repository.create.mockResolvedValue(saved);

    const result = await service.createDirect({
      lessonText: 'Use weekly report.',
      triggerContext: 'When I ask for the report',
    });

    expect(result.id).toBe('l1');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ confidenceScore: 1, status: 'active' }),
      expect.any(String),
    );
  });

  it('extractFromInteraction skips high ratings without correction', async () => {
    interactions.findOne.mockResolvedValue({ id: 'x1', rating: 5, correction: null });

    await service.extractFromInteraction('x1');

    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('mergeOrCreate merges when similarity is high and no contradiction', async () => {
    const existing = {
      id: 'e1',
      lessonText: 'Use weekly sales report.',
      embedding: JSON.stringify([1, 0, 0]),
      reinforcementCount: 1,
    } as LessonEntity;
    repository.listActiveForTask.mockResolvedValue([existing]);
    repository.mergeInto.mockResolvedValue({ ...existing, reinforcementCount: 2 } as LessonEntity);
    embeddings.tryEmbed.mockResolvedValue([1, 0, 0]);
    llm.chat.mockResolvedValue({ content: '{"contradicts": false}' });

    const result = await service.mergeOrCreate({
      taskType: 'quick_qa',
      triggerContext: 'report',
      lessonText: 'Use weekly sales report.',
      confidenceScore: 0.8,
    });

    expect(repository.mergeInto).toHaveBeenCalled();
    expect(result.reinforcementCount).toBe(2);
  });

  it('flags needs_review when contradiction judge returns true', async () => {
    const existing = {
      id: 'e2',
      lessonText: 'Use weekly sales report.',
      embedding: JSON.stringify([1, 0, 0]),
    } as LessonEntity;
    repository.listActiveForTask.mockResolvedValue([existing]);
    embeddings.tryEmbed.mockResolvedValue([1, 0, 0]);
    llm.chat.mockResolvedValue({ content: '{"contradicts": true, "reason": "conflict"}' });
    repository.create.mockResolvedValue({ id: 'n1', status: 'needs_review' } as LessonEntity);

    await service.mergeOrCreate({
      taskType: 'quick_qa',
      triggerContext: 'report',
      lessonText: 'Use monthly finance report.',
      confidenceScore: 0.9,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'needs_review' }),
      expect.any(String),
    );
  });

  it('findRelevantLessons excludes low confidence and needs_review via active list', async () => {
    repository.listAllActive.mockResolvedValue([
      {
        id: 'a1',
        lessonText: 'Active lesson',
        embedding: JSON.stringify([1, 0, 0]),
        confidenceScore: 0.8,
        taskType: 'quick_qa',
        reinforcementCount: 2,
      } as LessonEntity,
    ]);
    embeddings.tryEmbed.mockResolvedValue([1, 0, 0]);

    const result = await service.findRelevantLessons('report status', 'quick_qa');

    expect(result.texts).toContain('Active lesson');
    expect(result.ids).toContain('a1');
  });

  it('ensureBootstrapLessons creates pinned audit lessons once', async () => {
    repository.findByBootstrapKey.mockResolvedValue(null);
    repository.create.mockImplementation(async (draft) => ({ ...draft, id: 'boot-1' } as LessonEntity));

    await service.ensureBootstrapLessons();

    expect(repository.findByBootstrapKey).toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalled();
    expect(repository.saveEntity).toHaveBeenCalledWith(
      expect.objectContaining({ pinned: true, reinforcementCount: 5 }),
    );
  });
});
