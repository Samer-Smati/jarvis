import { toObjectType, treeToGroups, workspaceToGroups } from './holo-object.adapter';

describe('holo object adapter', () => {
  describe('toObjectType', () => {
    it('keeps known types', () => {
      expect(toObjectType('project')).toBe('project');
      expect(toObjectType('task')).toBe('task');
    });

    it('degrades an unknown type to a readable note rather than dropping it', () => {
      expect(toObjectType('spaceship')).toBe('note');
      expect(toObjectType(undefined)).toBe('note');
    });
  });

  describe('workspaceToGroups', () => {
    it('maps groups and items', () => {
      const groups = workspaceToGroups([
        {
          name: 'PROJECTS',
          type: 'folder',
          items: [{ id: 'p1', title: 'Jarvis', body: 'the assistant', type: 'project', metadata: { status: 'active' } }],
        },
      ]);
      expect(groups[0].name).toBe('PROJECTS');
      expect(groups[0].items[0]).toEqual({
        id: 'p1',
        title: 'Jarvis',
        body: 'the assistant',
        type: 'project',
        metadata: { status: 'active' },
      });
    });

    it('falls back to the id when an item has no title', () => {
      const groups = workspaceToGroups([
        { name: 'X', type: 'folder', items: [{ id: 'only-id', title: '', body: '', type: 'note' }] },
      ]);
      expect(groups[0].items[0].title).toBe('only-id');
    });

    it('drops empty groups so the deck has no dead orbs', () => {
      expect(workspaceToGroups([{ name: 'EMPTY', type: 'folder', items: [] }])).toEqual([]);
    });

    it('survives a malformed payload', () => {
      expect(workspaceToGroups(undefined as never)).toEqual([]);
      expect(workspaceToGroups([{ name: 'bad' } as never])).toEqual([]);
    });
  });

  describe('treeToGroups', () => {
    it('adapts the vault tree to the same scene groups', () => {
      const groups = treeToGroups([
        { kind: 'folder', name: 'CONCEPT', files: [{ name: 'a.md', title: 'Holo', body: 'deck', full: 'all of it' }] },
      ]);
      expect(groups[0].items[0]).toEqual({
        id: 'a.md',
        title: 'Holo',
        body: 'deck',
        type: 'note',
        metadata: { path: 'a.md', full: 'all of it' },
      });
    });

    it('survives a malformed payload', () => {
      expect(treeToGroups(undefined as never)).toEqual([]);
    });
  });
});
