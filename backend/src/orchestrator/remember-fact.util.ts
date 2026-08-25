/** Canonical identity preference keys JARVIS stores in user_preferences. */
export const IDENTITY_PREF_KEYS = [
  'user.name',
  'user.role',
  'user.former_employer',
  'user.industry',
  'user.region',
] as const;

export interface PreferenceWrite {
  key: string;
  value: string;
}

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

export function extractRememberFactKey(args: Record<string, unknown> | undefined): string | undefined {
  const raw = args?.key ?? args?.preference_key ?? args?.pref_key;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return undefined;
}

export function extractAlsoBrainFlag(args: Record<string, unknown> | undefined): boolean {
  const raw = args?.also_brain ?? args?.alsoBrain ?? args?.write_brain;
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

/** Explicit preferences map from tool args, if the model passed one. */
export function extractExplicitPreferences(
  args: Record<string, unknown> | undefined,
): PreferenceWrite[] {
  if (!args) {
    return [];
  }
  const raw = args.preferences ?? args.prefs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }
  const out: PreferenceWrite[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() && key.trim()) {
      out.push({ key: key.trim(), value: value.trim() });
    }
  }
  return out;
}

/**
 * Pull identity-style fields out of a prose fact so we can upsert user_preferences
 * instead of only a single semantic blob.
 */
export function extractIdentityPreferences(text: string): PreferenceWrite[] {
  const t = text.trim();
  if (!t) {
    return [];
  }

  const found = new Map<string, string>();

  const nameMatch =
    t.match(/\b(?:my name is|name is)\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)+)/i) ??
    t.match(/^([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)+)\s+is\s+a\b/);
  if (nameMatch?.[1]) {
    found.set('user.name', nameMatch[1].trim());
  }

  if (/\bfull[-\s]?stack\s+developer\b/i.test(t)) {
    found.set('user.role', 'full-stack developer');
  } else {
    const roleMatch = t.match(/\b(?:I am|I'm)\s+a\s+([^,.]+?developer)\b/i);
    if (roleMatch?.[1]) {
      found.set('user.role', roleMatch[1].trim().replace(/\s+/g, ' '));
    }
  }

  const employerMatch =
    t.match(/\bformerly\s+(?:at|with)\s+([A-Z][A-Za-z0-9&.'’-]{2,40})\b/) ??
    t.match(/\bformer[_\s-]?employer\s*[:=]\s*([^,.;]+)/i);
  if (employerMatch?.[1]) {
    found.set('user.former_employer', employerMatch[1].trim());
  }

  const industryMatch =
    t.match(/\b(AdTech|FinTech|HealthTech|EdTech|MarTech)\b/i) ??
    t.match(/\bindustry\s*[:=]\s*([^,.;]+)/i);
  if (industryMatch?.[1]) {
    const ind = industryMatch[1].trim();
    found.set('user.industry', /^adtech$/i.test(ind) ? 'AdTech' : ind);
  }

  if (/\bGCC\b/i.test(t) && /\bMENA\b/i.test(t)) {
    found.set('user.region', /\bDubai\b/i.test(t) ? 'GCC/MENA (Dubai)' : 'GCC/MENA');
  } else {
    const regionMatch =
      t.match(/\bregion\s*[:=]\s*([^,.;]+)/i) ?? t.match(/\b(Dubai|UAE)\b/i);
    if (regionMatch?.[1]) {
      const region = regionMatch[1].trim();
      found.set(
        'user.region',
        /dubai|uae/i.test(region) ? 'GCC/MENA (Dubai)' : region,
      );
    }
  }

  return [...found.entries()].map(([key, value]) => ({ key, value }));
}

export function resolvePreferenceWrites(
  args: Record<string, unknown> | undefined,
  factText: string,
): PreferenceWrite[] {
  const explicit = extractExplicitPreferences(args);
  if (explicit.length) {
    return explicit;
  }
  const key = extractRememberFactKey(args);
  if (key) {
    return [{ key, value: factText }];
  }
  return extractIdentityPreferences(factText);
}

export function formatRememberFactReply(result: {
  preferenceRows: Array<{ id: string; key: string; value: string }>;
  semanticRows: Array<{ id: string; text: string; memoryType: string }>;
  brainPath?: string;
}): string {
  const lines: string[] = [];
  if (result.preferenceRows.length) {
    lines.push(
      `Stored ${result.preferenceRows.length} user_preferences row(s): ` +
        result.preferenceRows.map((r) => `${r.key}=${r.value} (${r.id})`).join('; '),
    );
  }
  if (result.semanticRows.length) {
    lines.push(
      `Stored ${result.semanticRows.length} semantic_memories row(s): ` +
        result.semanticRows.map((r) => `${r.memoryType} ${r.id}`).join('; '),
    );
  }
  if (result.brainPath) {
    lines.push(`Also wrote brain vault page: ${result.brainPath}`);
  } else {
    lines.push('Brain vault was not updated.');
  }
  if (!result.preferenceRows.length && !result.semanticRows.length) {
    return 'Error: nothing was stored.';
  }
  return lines.join('\n');
}
