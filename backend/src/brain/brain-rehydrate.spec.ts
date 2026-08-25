import { BRAIN_REHYDRATE_CONFIRM_PHRASE } from '../brain/brain.service';
import { BrainPgStore } from '../brain/brain-pg.store';

describe('BrainPgStore.loadVaultFromPg', () => {
  it('merges page links with edge table paths', async () => {
    const pagesRepo = {
      find: jest.fn().mockResolvedValue([
        {
          path: 'concepts/a.md',
          title: 'A',
          category: 'concept',
          content: '# A',
          links: ['entities/jarvis.md'],
          createdAt: new Date('2026-07-01T00:00:00Z'),
          updatedAt: new Date('2026-07-02T00:00:00Z'),
        },
        {
          path: 'entities/jarvis.md',
          title: 'JARVIS',
          category: 'entity',
          content: '# JARVIS',
          links: [],
          createdAt: new Date('2026-07-01T00:00:00Z'),
          updatedAt: new Date('2026-07-02T00:00:00Z'),
        },
      ]),
    };
    const edgesRepo = {
      find: jest.fn().mockResolvedValue([
        { sourcePath: 'concepts/a.md', targetPath: 'entities/jarvis.md', kind: 'wiki' },
      ]),
    };
    const store = new BrainPgStore(
      pagesRepo as never,
      edgesRepo as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(store, 'enabled').mockReturnValue(true);

    const snapshot = await store.loadVaultFromPg();
    expect(snapshot?.pages.length).toBe(2);
    expect(snapshot?.edgeCount).toBe(1);
    expect(snapshot?.pages.find((p) => p.path === 'concepts/a.md')?.links).toContain('entities/jarvis.md');
    expect(snapshot?.pages.find((p) => p.path === 'entities/jarvis.md')?.links).toContain('concepts/a.md');
  });
});

describe('BRAIN_REHYDRATE_CONFIRM_PHRASE', () => {
  it('uses a fixed manual confirmation string', () => {
    expect(BRAIN_REHYDRATE_CONFIRM_PHRASE).toBe('REHYDRATE_FROM_PG');
  });
});
