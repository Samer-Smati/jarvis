import type { BrainPage } from '../brain/brain.types';
import type { SemanticMemoryEntity } from '../memory/entities/semantic-memory.entity';
import type { UserProjectEntity } from '../memory/entities/user-project.entity';
import type { EpisodicEventEntity } from '../memory/entities/episodic-event.entity';
import type { CalendarEventEntity } from '../skills/entities/calendar-event.entity';
import type { ReminderEntity } from '../skills/entities/reminder.entity';
import { BODY_MAX, TITLE_MAX } from './holo.notes.util';
import type { HoloItem, HoloWorkspaceGroup } from './holo.types';

/** Cards per orb. The deck fans these around an orb, and past a couple of dozen
 *  they stop being individually reachable by hand. */
export const ITEMS_PER_GROUP = 14;

function clip(text: string, max: number): string {
  return (text ?? '').toString().trim().slice(0, max);
}

/** Only ever build a group when it has contents — an empty orb is a dead end the
 *  user can open, stare at, and learn nothing from. */
function group(name: string, items: HoloItem[]): HoloWorkspaceGroup[] {
  return items.length ? [{ name, type: 'folder', items: items.slice(0, ITEMS_PER_GROUP) }] : [];
}

export function projectsToGroup(projects: UserProjectEntity[]): HoloWorkspaceGroup[] {
  const items = projects
    // Forgotten projects are soft-deleted, not history to be resurfaced spatially.
    .filter((p) => !p.forgottenAt)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name))
    .map<HoloItem>((project) => ({
      id: project.id,
      title: clip(project.name, TITLE_MAX),
      body: clip(project.description ?? `Status: ${project.status}`, BODY_MAX),
      type: 'project',
      metadata: {
        status: project.status,
        pinned: project.pinned,
        tags: project.tags ?? undefined,
        updatedAt: project.updatedAt?.toISOString?.(),
      },
    }));
  return group('PROJECTS', items);
}

export function remindersToGroup(reminders: ReminderEntity[], now = new Date()): HoloWorkspaceGroup[] {
  const items = reminders
    .filter((r) => !r.fired)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .map<HoloItem>((reminder) => {
      const due = new Date(reminder.dueAt);
      return {
        id: reminder.id,
        title: clip(reminder.text, TITLE_MAX),
        body: `Due ${due.toISOString()}${due.getTime() < now.getTime() ? ' (overdue)' : ''}`,
        type: 'task',
        metadata: { dueAt: due.toISOString(), overdue: due.getTime() < now.getTime() },
      };
    });
  return group('TASKS', items);
}

export function memoriesToGroup(facts: SemanticMemoryEntity[]): HoloWorkspaceGroup[] {
  const items = facts
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.confidence - a.confidence)
    .map<HoloItem>((fact) => ({
      id: fact.id,
      title: clip(fact.text, TITLE_MAX),
      body: clip(fact.text, BODY_MAX),
      type: 'memory',
      metadata: { memoryType: fact.memoryType, confidence: fact.confidence, pinned: fact.pinned },
    }));
  return group('MEMORIES', items);
}

export function eventsToGroup(events: EpisodicEventEntity[]): HoloWorkspaceGroup[] {
  const items = events.map<HoloItem>((event) => ({
    id: event.id,
    title: clip(event.summary, TITLE_MAX),
    body: clip(event.summary, BODY_MAX),
    type: 'event',
    metadata: { kind: event.kind, createdAt: event.createdAt?.toISOString?.() },
  }));
  return group('EVENTS', items);
}

export function calendarToGroup(events: CalendarEventEntity[]): HoloWorkspaceGroup[] {
  const items = events
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .map<HoloItem>((event) => ({
      id: event.id,
      title: clip(event.title, TITLE_MAX),
      body: clip(
        [new Date(event.startAt).toISOString(), event.location, event.notes].filter(Boolean).join(' · '),
        BODY_MAX,
      ),
      type: 'event',
      metadata: { startAt: new Date(event.startAt).toISOString(), location: event.location },
    }));
  return group('CALENDAR', items);
}

/** Brain vault pages, already grouped by category upstream. */
export function pagesToGroups(
  pages: BrainPage[],
  toTree: (pages: BrainPage[]) => Array<{ name: string; files: Array<{ name: string; title: string; body: string }> }>,
): HoloWorkspaceGroup[] {
  return toTree(pages).map((folder) => ({
    name: folder.name,
    type: 'folder',
    items: folder.files.map<HoloItem>((file) => ({
      id: file.name,
      title: file.title,
      body: file.body,
      type: 'note',
      metadata: { path: file.name },
    })),
  }));
}
