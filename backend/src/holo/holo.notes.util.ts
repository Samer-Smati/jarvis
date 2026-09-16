import type { BrainPage } from '../brain/brain.types';
import type { HoloFolder, HoloNote } from './holo.types';

/** Caps carried over from the reference deck's python server so cards render identically. */
export const TITLE_MAX = 48;
export const BODY_MAX = 420;
export const FULL_MAX = 4000;
export const FOLDER_NAME_MAX = 22;
export const FILES_PER_FOLDER = 14;

/**
 * Render a vault page the way the reference server rendered a markdown file: first
 * non-empty line becomes the title (minus its heading hashes), remaining non-heading
 * lines become the card body, and the untruncated remainder feeds the reader overlay.
 */
export function pageToNote(page: BrainPage): HoloNote {
  const lines = page.content.split('\n').filter((l) => l.trim());
  const headline = lines.length ? lines[0].replace(/^#+\s*/, '').trim() : '';
  const title = (headline || page.title || page.path).slice(0, TITLE_MAX);
  const rest = lines.slice(1).filter((l) => !l.startsWith('#'));
  return {
    name: page.path,
    title,
    body: rest.join('\n').slice(0, BODY_MAX),
    full: lines.slice(1).join('\n').slice(0, FULL_MAX),
  };
}

/**
 * Group vault pages into deck folders. The reference deck turned one level of
 * subdirectories into orbs; JARVIS's vault is flat but categorised, so each brain
 * category becomes an orb and its pages become that orb's cards.
 */
export function pagesToTree(pages: BrainPage[]): HoloFolder[] {
  const byCategory = new Map<string, BrainPage[]>();
  for (const page of pages) {
    const key = page.category || 'note';
    const bucket = byCategory.get(key);
    if (bucket) {
      bucket.push(page);
    } else {
      byCategory.set(key, [page]);
    }
  }

  const folders: HoloFolder[] = [];
  for (const [category, group] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const files = group
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, FILES_PER_FOLDER)
      .map(pageToNote);
    if (files.length) {
      folders.push({
        kind: 'folder',
        name: category.toUpperCase().slice(0, FOLDER_NAME_MAX),
        files,
      });
    }
  }
  return folders;
}
