import { Injectable, Logger } from '@nestjs/common';
import { Skill, SkillContext, SkillResult } from '../skill.interface';

interface DuckDuckGoTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractURL?: string;
  Answer?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; JARVIS/1.0; +https://github.com/Samer-Smati/jarvis)';

@Injectable()
export class WebSearchSkill implements Skill {
  private readonly logger = new Logger(WebSearchSkill.name);

  readonly name = 'web_search';
  readonly description =
    'Search the web and return a short summary with source links (DuckDuckGo + optional Hugging Face Hub lookup).';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      timeout: {
        type: 'number',
        description: 'Optional timeout in milliseconds (default 12000, max 25000).',
      },
    },
    required: ['query'],
  };

  async execute(args: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const query = String(args?.query ?? '').trim();
    if (!query) {
      return { success: false, output: 'Missing "query" argument.' };
    }

    const timeoutMs = clampTimeout(args?.timeout);
    context.onProgress?.({
      stage: 'web_search',
      message: `Searching: ${query}`,
      percent: 35,
    });

    try {
      const lines: string[] = [];
      const instant = await this.instantAnswer(query, timeoutMs);
      lines.push(...instant);

      context.onProgress?.({
        stage: 'web_search',
        message: 'Fetching web results…',
        percent: 55,
      });
      const htmlHits = await this.htmlSearch(query, timeoutMs);
      for (const hit of htmlHits.slice(0, 6)) {
        lines.push(
          hit.snippet
            ? `- ${hit.title}: ${hit.snippet} (${hit.url})`
            : `- ${hit.title} (${hit.url})`,
        );
      }

      if (/hugging\s*face|huggingface|hf\.co/i.test(query)) {
        context.onProgress?.({
          stage: 'web_search',
          message: 'Checking Hugging Face Hub…',
          percent: 70,
        });
        const hf = await this.huggingFaceModels(query, timeoutMs);
        if (hf.length) {
          lines.push('', 'Hugging Face Hub models:');
          lines.push(...hf);
        }
      }

      if (!lines.length) {
        return {
          success: false,
          output: `No web results found for "${query}". Try a shorter or more specific query.`,
        };
      }

      return { success: true, output: lines.join('\n') };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`web_search failed: ${message}`);
      return { success: false, output: `Search error: ${message}` };
    }
  }

  private async instantAnswer(query: string, timeoutMs: number): Promise<string[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    try {
      const response = await this.fetchText(url, timeoutMs);
      const data = JSON.parse(response) as DuckDuckGoResponse;
      const lines: string[] = [];
      if (data.Answer?.trim()) {
        lines.push(`Answer: ${data.Answer.trim()}`);
      }
      if (data.AbstractText?.trim()) {
        lines.push(
          `${data.AbstractText.trim()}${data.AbstractURL ? ` (${data.AbstractURL})` : ''}`,
        );
      }
      for (const topic of this.flattenTopics(data.RelatedTopics ?? []).slice(0, 4)) {
        if (topic.Text?.trim()) {
          lines.push(`- ${topic.Text.trim()}${topic.FirstURL ? ` (${topic.FirstURL})` : ''}`);
        }
      }
      return lines;
    } catch (error) {
      this.logger.debug(`instant answer skipped: ${(error as Error).message}`);
      return [];
    }
  }

  private async htmlSearch(query: string, timeoutMs: number): Promise<SearchHit[]> {
    const attempts: Array<{ url: string; init: RequestInit }> = [
      {
        url: 'https://html.duckduckgo.com/html/',
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'text/html',
            'User-Agent': USER_AGENT,
          },
          body: `q=${encodeURIComponent(query)}`,
        },
      },
      {
        url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        init: {
          method: 'GET',
          headers: {
            Accept: 'text/html',
            'User-Agent': USER_AGENT,
          },
        },
      },
    ];

    for (const endpoint of attempts) {
      try {
        const html = await this.fetchText(endpoint.url, timeoutMs, endpoint.init);
        const hits = parseDuckDuckGoHtml(html);
        if (hits.length) {
          return hits;
        }
      } catch (error) {
        this.logger.debug(`html search attempt failed: ${(error as Error).message}`);
      }
    }
    return [];
  }

  private async huggingFaceModels(query: string, timeoutMs: number): Promise<string[]> {
    const search = query
      .replace(/hugging\s*face|huggingface|hf\.co|models?|llm/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    const term = search || 'llm';
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(term)}&limit=5&sort=downloads&direction=-1`;
    try {
      const raw = await this.fetchText(url, timeoutMs, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      });
      const models = JSON.parse(raw) as Array<{
        id?: string;
        modelId?: string;
        downloads?: number;
        likes?: number;
        tags?: string[];
      }>;
      if (!Array.isArray(models) || !models.length) {
        return [];
      }
      return models.map((m) => {
        const id = m.id ?? m.modelId ?? 'unknown';
        const downloads = typeof m.downloads === 'number' ? m.downloads : 0;
        const likes = typeof m.likes === 'number' ? m.likes : 0;
        return `- ${id} — ${downloads} downloads, ${likes} likes (https://huggingface.co/${id})`;
      });
    } catch (error) {
      this.logger.debug(`HF hub lookup skipped: ${(error as Error).message}`);
      return [];
    }
  }

  private async fetchText(url: string, timeoutMs: number, init?: RequestInit): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          ...(init?.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.text();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private flattenTopics(topics: DuckDuckGoTopic[]): DuckDuckGoTopic[] {
    const flat: DuckDuckGoTopic[] = [];
    for (const topic of topics) {
      if (topic.Topics?.length) {
        flat.push(...this.flattenTopics(topic.Topics));
      } else {
        flat.push(topic);
      }
    }
    return flat;
  }
}

function clampTimeout(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.floor(n), 3000), 25_000);
}

function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const blocks = html.split(/class="[^"]*result[^"]*"/i).slice(1);
  const hits: SearchHit[] = [];

  for (const block of blocks) {
    const linkMatch =
      block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/href="(https?:\/\/[^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) {
      continue;
    }
    const url = cleanDuckDuckGoUrl(decodeBasicEntities(linkMatch[1] ?? ''));
    const title = decodeBasicEntities(stripTags(linkMatch[2] ?? '')).trim();
    if (!url || !title || /duckduckgo\.com\/y\.js/i.test(url)) {
      continue;
    }
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//i);
    const snippet = snippetMatch
      ? decodeBasicEntities(stripTags(snippetMatch[1] ?? '')).trim()
      : undefined;
    hits.push({ title, url, snippet: snippet || undefined });
    if (hits.length >= 8) {
      break;
    }
  }

  if (hits.length) {
    return hits;
  }

  // Fallback: any result__a anchors if block split failed
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && hits.length < 8) {
    const url = cleanDuckDuckGoUrl(decodeBasicEntities(match[1] ?? ''));
    const title = decodeBasicEntities(stripTags(match[2] ?? '')).trim();
    if (url && title && !/duckduckgo\.com\/y\.js/i.test(url)) {
      hits.push({ title, url });
    }
  }
  return hits;
}

function cleanDuckDuckGoUrl(href: string): string {
  try {
    const parsed = new URL(href, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    return parsed.toString();
  } catch {
    return href;
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
