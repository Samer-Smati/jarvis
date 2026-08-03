export interface SkillsShHit {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  url: string;
  sourceType?: string;
}

interface SkillsShSearchResponse {
  data?: Array<{
    id?: string;
    slug?: string;
    name?: string;
    source?: string;
    installs?: number;
    url?: string;
    sourceType?: string;
    isDuplicate?: boolean;
  }>;
  count?: number;
}

const SEARCH_TIMEOUT_MS = 12_000;

export async function searchSkillsSh(
  query: string,
  options?: { limit?: number; owner?: string; token?: string },
): Promise<{ hits: SkillsShHit[]; error?: string }> {
  const q = query.trim();
  if (q.length < 2) {
    return { hits: [], error: 'Search query must be at least 2 characters.' };
  }

  const token =
    options?.token?.trim() ||
    process.env.VERCEL_OIDC_TOKEN?.trim() ||
    process.env.SKILLS_SH_TOKEN?.trim() ||
    '';
  if (!token) {
    return {
      hits: [],
      error:
        'skills.sh API needs VERCEL_OIDC_TOKEN (enable OIDC Federation on the Vercel project) or SKILLS_SH_TOKEN.',
    };
  }

  const params = new URLSearchParams({
    q,
    limit: String(Math.min(Math.max(options?.limit ?? 8, 1), 50)),
  });
  if (options?.owner?.trim()) {
    params.set('owner', options.owner.trim());
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://skills.sh/api/v1/skills/search?${params}`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'JARVIS/1.0 (+https://github.com/Samer-Smati/jarvis)',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        hits: [],
        error: `skills.sh search HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      };
    }
    const json = (await res.json()) as SkillsShSearchResponse;
    const hits = (json.data ?? [])
      .filter((row) => !row.isDuplicate && row.slug && row.source)
      .map(
        (row): SkillsShHit => ({
          id: String(row.id ?? `${row.source}/${row.slug}`),
          slug: String(row.slug),
          name: String(row.name ?? row.slug),
          source: String(row.source),
          installs: Number(row.installs ?? 0),
          url: String(row.url ?? `https://skills.sh/${row.source}/${row.slug}`),
          sourceType: row.sourceType,
        }),
      );
    return { hits };
  } catch (error) {
    return { hits: [], error: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
