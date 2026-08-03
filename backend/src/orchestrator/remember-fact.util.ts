/** Resolve remember_fact payload from common LLM argument shapes. */
export function extractRememberFactText(args: Record<string, unknown> | undefined): string {
  if (!args) {
    return '';
  }
  const candidates = [args.fact, args.text, args.content, args.memory, args.preference, args.value];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}
