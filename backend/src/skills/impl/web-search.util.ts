export const WEB_SEARCH_UNAVAILABLE_PREFIX =
  "I wasn't able to search the web just now, sir — I don't have verified current results.";

export function buildWebSearchUnavailableMessage(detail?: string): string {
  let msg =
    `${WEB_SEARCH_UNAVAILABLE_PREFIX} Anything below would be from memory, not live search — treat it as outdated and try again shortly.`;
  const line = detail?.split('\n')[0]?.trim();
  if (line && line.length > 12 && !line.startsWith('Permission denied')) {
    msg += ` Search detail: ${line.slice(0, 160)}`;
  }
  return msg;
}

export function isFailedWebSearchOutput(output: string): boolean {
  const text = output.trim();
  if (!text) {
    return true;
  }
  if (text.startsWith('Error:')) {
    return true;
  }
  if (text.startsWith('Search error:')) {
    return true;
  }
  if (text.startsWith('No web results found')) {
    return true;
  }
  if (text.startsWith('Missing "query"')) {
    return true;
  }
  if (/TAVILY_API_KEY/i.test(text)) {
    return true;
  }
  if (text.includes('Permission denied')) {
    return true;
  }
  return false;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface TavilyWebResult {
  title?: string;
  url?: string;
  content?: string;
}

export function formatSearchHits(hits: SearchHit[]): string[] {
  return hits.map((hit) =>
    hit.snippet ? `- ${hit.title}: ${hit.snippet} (${hit.url})` : `- ${hit.title} (${hit.url})`,
  );
}

export function mapTavilyResults(results: TavilyWebResult[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const row of results) {
    const title = row.title?.trim();
    const url = row.url?.trim();
    if (!title || !url) {
      continue;
    }
    hits.push({
      title,
      url,
      snippet: row.content?.trim() || undefined,
    });
    if (hits.length >= 8) {
      break;
    }
  }
  return hits;
}
