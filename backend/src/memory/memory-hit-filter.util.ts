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

export function filterStaleMemoryHits(hits: string[]): string[] {
  return hits.filter((hit) => !isStaleFastPathBoilerplate(hit));
}
