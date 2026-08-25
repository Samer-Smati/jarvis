import { BrainPgStore } from '../brain/brain-pg.store';
import { EmbeddingService } from '../llm/embedding.service';
import { MemoryService } from './memory.service';

describe('MemoryService.rememberFact', () => {
  let semantic: { save: jest.Mock; create: jest.Mock; find: jest.Mock };
  let embeddings: jest.Mocked<Pick<EmbeddingService, 'tryEmbed'>>;
  let brainPg: jest.Mocked<Pick<BrainPgStore, 'indexChunk'>>;

  const buildService = () =>
    new MemoryService(
      {} as never,
      {} as never,
      semantic as never,
      embeddings as unknown as EmbeddingService,
      brainPg as unknown as BrainPgStore,
    );

  beforeEach(() => {
    semantic = {
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((data) => data),
      find: jest.fn().mockResolvedValue([]),
    };
    embeddings = { tryEmbed: jest.fn() };
    brainPg = { indexChunk: jest.fn().mockResolvedValue(undefined) };
  });

  it('inserts a new fact when no similar one exists', async () => {
    embeddings.tryEmbed.mockResolvedValue([1, 0, 0]);
    semantic.find.mockResolvedValue([]);

    await buildService().rememberFact('User likes tea.');

    expect(semantic.save).toHaveBeenCalledTimes(1);
  });

  it('skips inserting a near-duplicate fact', async () => {
    embeddings.tryEmbed.mockResolvedValue([1, 0, 0]);
    semantic.find.mockResolvedValue([{ text: 'User likes tea.', embedding: JSON.stringify([1, 0, 0]) }]);

    await buildService().rememberFact('User really likes tea.');

    expect(semantic.save).not.toHaveBeenCalled();
  });

  it('always inserts when embeddings are unavailable', async () => {
    embeddings.tryEmbed.mockResolvedValue(null);
    semantic.find.mockResolvedValue([{ text: 'User likes tea.', embedding: JSON.stringify([1, 0, 0]) }]);

    await buildService().rememberFact('User likes tea.');

    expect(semantic.save).toHaveBeenCalledTimes(1);
  });
});
