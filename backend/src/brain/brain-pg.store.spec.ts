import { BrainPgStore } from './brain-pg.store';

describe('BrainPgStore.searchSimilar', () => {
  it('skips embedding calls when there are no memory chunks', async () => {
    const embeddings = { tryEmbed: jest.fn() };
    const chunks = {
      count: jest.fn().mockResolvedValue(0),
      query: jest.fn(),
    };
    const store = Object.create(BrainPgStore.prototype) as BrainPgStore;
    Object.assign(store, {
      embeddings,
      chunks,
      enabled: () => true,
      keywordFallback: jest.fn(),
      logger: { warn: jest.fn() },
    });

    const hits = await store.searchSimilar('who am I', 5);

    expect(hits).toEqual([]);
    expect(embeddings.tryEmbed).not.toHaveBeenCalled();
    expect(chunks.query).not.toHaveBeenCalled();
  });
});
