const STALE_FAST_PATH_PATTERNS = [
  /Relational mapping complete, sir/i,
  /Brain cleaned up, sir/i,
  /Brain vault is tidy, sir/i,
  /Opening your brain graph, sir/i,
  /BRAIN_GRAPH: Consolidated knowledge graph/i,
  /Brain cleanup complete — removed \d+ page/i,
];

export function isStaleFastPathBoilerplate(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const jarvisLine = trimmed.match(/JARVIS:\s*(.+)/s)?.[1]?.trim() ?? trimmed;
  return STALE_FAST_PATH_PATTERNS.some((pattern) => pattern.test(jarvisLine));
}

/** Indexed chat turns look like `User: …\nJARVIS: …` — not durable facts. */
export function isConversationTurnHit(text: string): boolean {
  const trimmed = text.trim();
  return /^User:\s/im.test(trimmed) && /\nJARVIS:\s/i.test(trimmed);
}

export function filterStaleMemoryHits(hits: string[]): string[] {
  return hits.filter((hit) => !isStaleFastPathBoilerplate(hit));
}

/** For recallFacts / about-me: drop boilerplate and raw turn transcripts. */
export function filterFactMemoryHits(hits: string[]): string[] {
  return hits.filter((hit) => !isStaleFastPathBoilerplate(hit) && !isConversationTurnHit(hit));
}
