import type { SceneGroup, SceneItem } from '../scene/scene-engine';
import type { HoloObjectType } from '../scene/scene.types';

/** The wire shape of GET /api/holo/workspace. Mirrored rather than imported —
 *  the frontend does not depend on backend types. */
export interface WorkspaceGroupDto {
  name: string;
  type: string;
  items: Array<{
    id: string;
    title: string;
    body: string;
    type: string;
    metadata?: Record<string, unknown>;
  }>;
}

/** The older GET /api/holo/tree shape, still the brain vault's own view. */
export interface FolderDto {
  kind?: string;
  name: string;
  files: Array<{ name: string; title: string; body: string; full?: string }>;
}

const KNOWN: HoloObjectType[] = [
  'folder',
  'note',
  'file',
  'project',
  'task',
  'memory',
  'event',
  'ai-node',
  'prop',
];

/** Unknown types degrade to a note rather than being dropped: a card the deck
 *  cannot classify is still a card the user should be able to read. */
export function toObjectType(value: unknown): HoloObjectType {
  return KNOWN.includes(value as HoloObjectType) ? (value as HoloObjectType) : 'note';
}

/**
 * Wire data to scene groups.
 *
 * This is the only place that knows both shapes. The scene engine never sees a
 * DTO, and the API layer never sees a SceneObject, which is what keeps JARVIS's
 * data model and the deck's interaction model independent of one another.
 */
export function workspaceToGroups(groups: WorkspaceGroupDto[]): SceneGroup[] {
  return (groups ?? [])
    .filter((group) => group && Array.isArray(group.items))
    .map((group) => ({
      name: group.name,
      type: 'folder' as HoloObjectType,
      items: group.items.map<SceneItem>((item) => ({
        id: item.id,
        title: item.title || item.id,
        body: item.body ?? '',
        type: toObjectType(item.type),
        metadata: item.metadata,
      })),
    }))
    .filter((group) => group.items.length > 0);
}

/** The brain vault's folder/file view, adapted to the same scene groups. */
export function treeToGroups(folders: FolderDto[]): SceneGroup[] {
  return (folders ?? [])
    .filter((folder) => folder && Array.isArray(folder.files))
    .map((folder) => ({
      name: folder.name,
      type: 'folder' as HoloObjectType,
      items: folder.files.map<SceneItem>((file) => ({
        id: file.name,
        title: file.title || file.name,
        body: file.body ?? '',
        type: 'note' as HoloObjectType,
        metadata: { path: file.name, full: file.full },
      })),
    }))
    .filter((group) => group.items.length > 0);
}
