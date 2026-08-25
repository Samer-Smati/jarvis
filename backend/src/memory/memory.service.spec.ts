import { BrainPgStore } from '../brain/brain-pg.store';
import { EmbeddingService } from '../llm/embedding.service';
import { LessonsService } from '../lessons/lessons.service';
import { MemoryRepository } from './memory.repository';
import { MemoryService } from './memory.service';

describe('MemoryService.rememberFact', () => {
  let semantic: { find: jest.Mock };
  let repository: jest.Mocked<Pick<MemoryRepository, 'createFact'>>;
  let embeddings: jest.Mocked<Pick<EmbeddingService, 'tryEmbed'>>;
  let brainPg: jest.Mocked<Pick<BrainPgStore, 'indexChunk'>>;

  const buildService = () =>
    new MemoryService(
      {} as never,
      {} as never,
      semantic as never,
      {} as never,
      {} as never,
      embeddings as unknown as EmbeddingService,
      brainPg as unknown as BrainPgStore,
      repository as unknown as MemoryRepository,
      {} as unknown as LessonsService,
    );

  beforeEach(() => {
    semantic = {
      find: jest.fn().mockResolvedValue([]),
    };
    repository = {
      createFact: jest.fn().mockResolvedValue({ id: 'fact-1', text: 'User likes tea.', memoryType: 'fact' }),
    };
    embeddings = { tryEmbed: jest.fn() };
    brainPg = { indexChunk: jest.fn().mockResolvedValue(undefined) };
  });

  it('inserts a new fact when no similar one exists', async () => {
    embeddings.tryEmbed.mockResolvedValue([1, 0, 0]);
    semantic.find.mockResolvedValue([]);

    await buildService().rememberFact('User likes tea.');

    expect(repository.createFact).toHaveBeenCalledTimes(1);
  });

  it('skips inserting a near-duplicate fact', async () => {
    embeddings.tryEmbed.mockResolvedValue([1, 0, 0]);
    semantic.find.mockResolvedValue([{ text: 'User likes tea.', embedding: JSON.stringify([1, 0, 0]) }]);

    await buildService().rememberFact('User really likes tea.');

    expect(repository.createFact).not.toHaveBeenCalled();
  });

  it('always inserts when embeddings are unavailable', async () => {
    embeddings.tryEmbed.mockResolvedValue(null);
    semantic.find.mockResolvedValue([{ text: 'User likes tea.', embedding: JSON.stringify([1, 0, 0]) }]);

    await buildService().rememberFact('User likes tea.');

    expect(repository.createFact).toHaveBeenCalledTimes(1);
  });
});
