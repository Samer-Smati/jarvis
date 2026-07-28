import { Injectable, Logger } from '@nestjs/common';
import { Skill, SkillContext, SkillResult } from '../skill.interface';
import {
  formatSearchHits,
  mapBraveResults,
  type BraveWebResult,
  type SearchHit,
} from './web-search.util';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_TIMEOUT_MS = 12_000;
const SERVERLESS_TIMEOUT_MS = 20_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; JARVIS/1.0; +https://github.com/Samer-Smati/jarvis)';

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

@Injectable()
export class WebSearchSkill implements Skill {
  private readonly logger = new Logger(WebSearchSkill.name);

  readonly name = 'web_search';
  readonly description =
    'Search the web via Brave Search API and return a short summary with source links (optional Hugging Face Hub enrichment for model queries).';
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

    const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
    if (!apiKey) {
      return {
        success: false,
        output:
          'Search error: BRAVE_SEARCH_API_KEY is not set. Add a Brave Search API key to enable web_search.',
      };
    }

    const timeoutMs = clampTimeout(args?.timeout, isServerlessRuntime());
    context.onProgress?.({
      stage: 'web_search',
      message: `Searching: ${query}`,
      percent: 35,
    });

    try {
      context.onProgress?.({
        stage: 'web_search',
        message: 'Fetching web results…',
        percent: 55,
      });

      const brave = await this.braveWebSearch(query, apiKey, timeoutMs);
      const lines = [...formatSearchHits(brave.hits)];

      if (this.shouldQueryHfHub(query)) {
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
        const detail = `[provider=brave status=${brave.status} hits=0${brave.error ? ` error=${brave.error}` : ''}]`;
        this.logger.warn(`web_search empty results for "${query}": ${detail}`);
        return {
          success: false,
          output: `No web results found for "${query}". ${detail}`,
        };
      }

      return { success: true, output: lines.join('\n') };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`web_search failed for "${query}": ${message}`);
      return { success: false, output: `Search error: ${message}` };
    }
  }

  private async braveWebSearch(
    query: string,
    apiKey: string,
    timeoutMs: number,
  ): Promise<{ hits: SearchHit[]; status: number; error?: string }> {
    const url = new URL(BRAVE_SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('count', '8');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
          'User-Agent': USER_AGENT,
        },
      });

      const body = await response.text();
      if (!response.ok) {
        const snippet = body.slice(0, 200).replace(/\s+/g, ' ').trim();
        throw new Error(
          `Brave Search HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`,
        );
      }

      let parsed: BraveSearchResponse;
      try {
        parsed = JSON.parse(body) as BraveSearchResponse;
      } catch {
        throw new Error('Brave Search returned invalid JSON');
      }

      const hits = mapBraveResults(parsed.web?.results ?? []);
      return { hits, status: response.status };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Timed out after ${timeoutMs}ms calling Brave Search`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private shouldQueryHfHub(query: string): boolean {
    if (/hugging\s*face|huggingface|hf\.co/i.test(query)) {
      return true;
    }
    return /\b(llm|llms|open.?source model|language model|gemma|llama|qwen|mistral|deepseek|model hub)\b/i.test(
      query,
    );
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
        throw new Error(`Timed out after ${timeoutMs}ms fetching ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function clampTimeout(raw: unknown, serverless = false): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  const fallback = serverless ? SERVERLESS_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(n), 3000), 25_000);
}

function isServerlessRuntime(): boolean {
  return !!process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1';
}
