import type { BrainPage } from '../brain/brain.types';
import type { EpisodicEventEntity } from '../memory/entities/episodic-event.entity';
import type { SemanticMemoryEntity } from '../memory/entities/semantic-memory.entity';
import type { UserProjectEntity } from '../memory/entities/user-project.entity';
import type { CalendarEventEntity } from '../skills/entities/calendar-event.entity';
import type { ReminderEntity } from '../skills/entities/reminder.entity';
import { pagesToTree } from './holo.notes.util';
import {
  ITEMS_PER_GROUP,
  calendarToGroup,
  eventsToGroup,
  memoriesToGroup,
  pagesToGroups,
  projectsToGroup,
  remindersToGroup,
} from './holo.workspace.util';

const project = (over: Partial<UserProjectEntity> = {}): UserProjectEntity =>
  ({
    id: 'p1',
    name: 'Jarvis',
    description: 'the assistant',
    status: 'active',
    pinned: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    ...over,
  }) as UserProjectEntity;

describe('holo workspace mappers', () => {
  describe('projectsToGroup', () => {
    it('maps projects to project cards', () => {
      const [group] = projectsToGroup([project()]);
      expect(group.name).toBe('PROJECTS');
      expect(group.items[0]).toEqual(
        expect.objectContaining({ id: 'p1', title: 'Jarvis', type: 'project' }),
      );
    });

    it('omits forgotten projects', () => {
      expect(projectsToGroup([project({ forgottenAt: new Date() })])).toEqual([]);
    });

    it('puts pinned projects first', () => {
      const groups = projectsToGroup([
        project({ id: 'a', name: 'Alpha' }),
        project({ id: 'b', name: 'Beta', pinned: true }),
      ]);
      expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'a']);
    });

    it('falls back to the status when a project has no description', () => {
      const [group] = projectsToGroup([project({ description: undefined, status: 'paused' })]);
      expect(group.items[0].body).toContain('paused');
    });

    it('produces no group at all rather than an empty orb', () => {
      expect(projectsToGroup([])).toEqual([]);
    });

    it('caps a group at the fan limit', () => {
      const many = Array.from({ length: ITEMS_PER_GROUP + 6 }, (_, i) =>
        project({ id: `p${i}`, name: `P${i}` }),
      );
      expect(projectsToGroup(many)[0].items.length).toBe(ITEMS_PER_GROUP);
    });
  });

  describe('remindersToGroup', () => {
    const reminder = (over: Partial<ReminderEntity> = {}): ReminderEntity =>
      ({ id: 'r1', text: 'call back', dueAt: new Date('2026-06-01'), fired: false, ...over }) as ReminderEntity;

    it('keeps only unfired reminders, soonest first', () => {
      const [group] = remindersToGroup([
        reminder({ id: 'late', dueAt: new Date('2026-07-01') }),
        reminder({ id: 'soon', dueAt: new Date('2026-05-01') }),
        reminder({ id: 'done', fired: true }),
      ]);
      expect(group.items.map((i) => i.id)).toEqual(['soon', 'late']);
    });

    it('flags an overdue reminder against the supplied clock', () => {
      const [group] = remindersToGroup([reminder()], new Date('2026-09-01'));
      expect(group.items[0].body).toContain('overdue');
      expect(group.items[0].metadata?.['overdue']).toBe(true);
    });
  });

  describe('memoriesToGroup', () => {
    const fact = (over: Partial<SemanticMemoryEntity> = {}): SemanticMemoryEntity =>
      ({ id: 'm1', text: 'samer prefers dark mode', memoryType: 'preference', confidence: 0.8, pinned: false, ...over }) as SemanticMemoryEntity;

    it('ranks pinned facts above confident ones', () => {
      const [group] = memoriesToGroup([
        fact({ id: 'confident', confidence: 0.99 }),
        fact({ id: 'pinned', confidence: 0.1, pinned: true }),
      ]);
      expect(group.items[0].id).toBe('pinned');
    });
  });

  describe('eventsToGroup', () => {
    it('maps episodic events', () => {
      const [group] = eventsToGroup([
        { id: 'e1', kind: 'holo_gesture', summary: 'Holo deck: grab', createdAt: new Date('2026-09-01') } as EpisodicEventEntity,
      ]);
      expect(group.items[0]).toEqual(
        expect.objectContaining({ id: 'e1', type: 'event', title: 'Holo deck: grab' }),
      );
    });
  });

  describe('calendarToGroup', () => {
    it('orders by start time and carries the location', () => {
      const [group] = calendarToGroup([
        { id: 'late', title: 'Retro', startAt: new Date('2026-09-02T10:00:00Z') } as CalendarEventEntity,
        { id: 'early', title: 'Standup', startAt: new Date('2026-09-01T09:00:00Z'), location: 'Room 2' } as CalendarEventEntity,
      ]);
      expect(group.items.map((i) => i.id)).toEqual(['early', 'late']);
      expect(group.items[0].body).toContain('Room 2');
    });
  });

  describe('pagesToGroups', () => {
    it('reuses the existing vault grouping rather than regrouping pages', () => {
      const pages: BrainPage[] = [
        {
          path: 'concepts/holo.md',
          title: 'Holo',
          category: 'concept',
          content: '# Holo\nspatial deck',
          links: [],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ];
      const groups = pagesToGroups(pages, pagesToTree);
      expect(groups[0].name).toBe('CONCEPT');
      expect(groups[0].items[0]).toEqual(
        expect.objectContaining({ type: 'note', title: 'Holo', metadata: { path: 'concepts/holo.md' } }),
      );
    });
  });
});
