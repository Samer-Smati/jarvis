import type { BrainPage } from './brain.types';

export const JARVIS_ENTITY_PATH = 'entities/jarvis.md';

/** Non-person entities that must never be treated as the user profile. */
export function isNonPersonEntityPage(page: Pick<BrainPage, 'title' | 'path'>): boolean {
  const blob = `${page.title} ${page.path}`;
  return /\b(hugging\s*face|models?\s+list|model hub|open.?source models|llama|mistral|qwen)\b/i.test(
    blob,
  );
}

/**
 * Strip wiki links / Related: backlink noise so content matching doesn't
 * treat [[User Profile]] mentions as identity evidence.
 */
export function stripWikiNoise(content: string): string {
  return content
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/^Related:\s*.*$/gim, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score candidate entity pages for "who is the user?" retrieval.
 * Higher is better; 0 means not a user-profile candidate.
 */
export function scoreUserEntityCandidate(page: Pick<BrainPage, 'title' | 'path' | 'category' | 'content'>): number {
  if (page.category !== 'entity') {
    return 0;
  }
  if (page.path === JARVIS_ENTITY_PATH) {
    return 0;
  }
  if (isNonPersonEntityPage(page)) {
    return 0;
  }

  const titlePath = `${page.title} ${page.path}`;
  let score = 0;

  if (/entities\/user[-_/]/i.test(page.path) || /user-samer|samer-smati/i.test(page.path)) {
    score += 100;
  }
  if (/^user profile$/i.test(page.title.trim()) || /\bsamer(\s+smati)?\b/i.test(page.title)) {
    score += 80;
  }
  if (/\b(user profile|profile entity)\b/i.test(titlePath)) {
    score += 40;
  }

  const body = stripWikiNoise(page.content);
  if (/\bsamer(\s+smati)?\b/i.test(body)) {
    score += 50;
  }
  if (/\b(full-?stack|adtech|jarvis owner|personal (steward|assistant) for)\b/i.test(body)) {
    score += 25;
  }
  if (/\b(my name is|i am (the )?owner|you are[, ]+sir)\b/i.test(body)) {
    score += 20;
  }

  // Generic "user|profile|owner|sir" alone in body is too weak — that is what
  // falsely selected Hugging Face Models List via [[User Profile]] / "im your owner" links.
  return score;
}

export function selectUserEntityPage<T extends Pick<BrainPage, 'title' | 'path' | 'category' | 'content' | 'updatedAt'>>(
  pages: T[],
): T | null {
  const ranked = pages
    .map((page) => ({ page, score: scoreUserEntityCandidate(page) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return new Date(b.page.updatedAt).getTime() - new Date(a.page.updatedAt).getTime();
    });
  return ranked[0]?.page ?? null;
}
