import { buildRawSkillUrl, normalizeSkillSlug } from './skill-import.util';
import { searchSkillsSh, SkillsShHit } from './skills-sh.client';

/** Curated fallbacks when skills.sh API auth is unavailable (offline / no OIDC). */
export const CURATED_SKILL_CATALOG: Array<{
  queryHints: string[];
  slug: string;
  source: string;
  name: string;
  installs: number;
}> = [
  {
    queryHints: ['find skill', 'discover skill', 'skill search', 'skills.sh'],
    slug: 'find-skills',
    source: 'vercel-labs/skills',
    name: 'find-skills',
    installs: 2_800_000,
  },
  {
    queryHints: ['plan', 'implementation plan', 'writing plans'],
    slug: 'writing-plans',
    source: 'obra/superpowers',
    name: 'writing-plans',
    installs: 207_000,
  },
  {
    queryHints: ['code review', 'review pr', 'request review'],
    slug: 'requesting-code-review',
    source: 'obra/superpowers',
    name: 'requesting-code-review',
    installs: 188_000,
  },
  {
    queryHints: ['tdd', 'test driven', 'unit test', 'red green'],
    slug: 'test-driven-development',
    source: 'obra/superpowers',
    name: 'test-driven-development',
    installs: 186_000,
  },
  {
    queryHints: ['debug', 'root cause', 'bug'],
    slug: 'systematic-debugging',
    source: 'obra/superpowers',
    name: 'systematic-debugging',
    installs: 210_000,
  },
  {
    queryHints: ['verify', 'verification', 'done', 'completion'],
    slug: 'verification-before-completion',
    source: 'obra/superpowers',
    name: 'verification-before-completion',
    installs: 165_000,
  },
  {
    queryHints: ['react', 'next.js', 'nextjs', 'performance'],
    slug: 'vercel-react-best-practices',
    source: 'vercel-labs/agent-skills',
    name: 'vercel-react-best-practices',
    installs: 600_000,
  },
  {
    queryHints: ['postgres', 'sql', 'database', 'neon'],
    slug: 'supabase-postgres-best-practices',
    source: 'supabase/agent-skills',
    name: 'supabase-postgres-best-practices',
    installs: 322_000,
  },
];

export function isSkillFindRequest(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  if (/\b(find|search|discover)\s+(a\s+|me\s+)?(an?\s+)?skills?\b/i.test(t)) {
    return true;
  }
  if (/\bis there a skill\b/i.test(t)) {
    return true;
  }
  if (/\b(skill for|skills for|skill that can)\b/i.test(t)) {
    return true;
  }
  if (/\bextend (my |jarvis |your )?capabilities\b/i.test(t)) {
    return true;
  }
  return false;
}

export function extractSkillFindQuery(text: string): string {
  const t = text.trim();
  const patterns = [
    /\b(?:find|search|discover)\s+(?:a\s+|me\s+)?(?:an?\s+)?skills?\s+(?:for|about|to)\s+(.+)$/i,
    /\bis there a skill\s+(?:for|to|that can)\s+(.+)$/i,
    /\bskills?\s+for\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(t);
    if (match?.[1]) {
      return match[1].replace(/[?.!]+$/, '').trim();
    }
  }
  return t
    .replace(/\b(find|search|discover|please|jarvis)\b/gi, ' ')
    .replace(/\b(a|an|the|skill|skills|for|about)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchCuratedSkills(query: string, limit = 5): SkillsShHit[] {
  const q = query.toLowerCase();
  const scored = CURATED_SKILL_CATALOG.map((row) => {
    let score = 0;
    for (const hint of row.queryHints) {
      if (q.includes(hint) || hint.split(/\s+/).every((w) => q.includes(w))) {
        score += 10;
      }
      for (const word of hint.split(/\s+/)) {
        if (word.length > 2 && q.includes(word)) {
          score += 1;
        }
      }
    }
    if (q.includes(row.slug) || q.includes(row.name.toLowerCase())) {
      score += 20;
    }
    return { row, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.row.installs - a.row.installs)
    .slice(0, limit);

  return scored.map(({ row }) => ({
    id: `${row.source}/${row.slug}`,
    slug: row.slug,
    name: row.name,
    source: row.source,
    installs: row.installs,
    url: `https://skills.sh/${row.source}/${row.slug}`,
    sourceType: 'github',
  }));
}

export async function findSkillsForQuery(query: string): Promise<{
  hits: SkillsShHit[];
  source: 'skills.sh' | 'curated';
  notice?: string;
}> {
  const api = await searchSkillsSh(query, { limit: 8 });
  if (api.hits.length) {
    return { hits: api.hits, source: 'skills.sh' };
  }
  const curated = searchCuratedSkills(query, 5);
  return {
    hits: curated,
    source: 'curated',
    notice: api.error,
  };
}

export function pickBestImportableSkill(hits: SkillsShHit[]): SkillsShHit | null {
  const github = hits.filter((h) => {
    if (h.sourceType && h.sourceType !== 'github') {
      return false;
    }
    const built = buildRawSkillUrl(h.source, h.slug);
    return built.ok;
  });
  if (!github.length) {
    return null;
  }
  const trustedOwners = new Set([
    'obra',
    'anthropics',
    'vercel-labs',
    'supabase',
    'microsoft',
  ]);
  github.sort((a, b) => {
    const aTrusted = trustedOwners.has(a.source.split('/')[0] ?? '') ? 1 : 0;
    const bTrusted = trustedOwners.has(b.source.split('/')[0] ?? '') ? 1 : 0;
    if (aTrusted !== bTrusted) {
      return bTrusted - aTrusted;
    }
    return b.installs - a.installs;
  });
  return github[0] ?? null;
}

export function buildSkillFindListReply(input: {
  query: string;
  hits: SkillsShHit[];
  source: 'skills.sh' | 'curated';
  notice?: string;
  autoImport?: { slug: string; source: string };
}): string {
  const lines = [
    `Skill search for "${input.query}" (${input.source}${input.notice ? `; API note: ${input.notice}` : ''}):`,
    '',
  ];
  if (!input.hits.length) {
    lines.push('No matching skills found. Try a more specific query, or name an owner/repo directly.');
    return lines.join('\n');
  }
  for (const [i, hit] of input.hits.slice(0, 5).entries()) {
    lines.push(
      `${i + 1}. ${hit.name} (${hit.source}/${hit.slug}) — ${hit.installs.toLocaleString()} installs`,
    );
    lines.push(`   ${hit.url}`);
    lines.push(`   Import: import skill ${normalizeSkillSlug(hit.slug)} from ${hit.source}`);
  }
  if (input.autoImport) {
    lines.push(
      '',
      `Auto-importing top trusted match: ${input.autoImport.slug} from ${input.autoImport.source}…`,
    );
  }
  return lines.join('\n');
}
