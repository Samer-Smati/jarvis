import { Injectable, Logger } from '@nestjs/common';
import { Skill, SkillContext, SkillResult } from '../skill.interface';
import {
  formatSearchHits,
  mapTavilyResults,
  type SearchHit,
  type TavilyWebResult,
} from './web-search.util';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const DEFAULT_TIMEOUT_MS = 12_000;
const SERVERLESS_TIMEOUT_MS = 20_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; JARVIS/1.0; +https://github.com/Samer-Smati/jarvis)';

interface TavilySearchResponse {
  results?: TavilyWebResult[];
}

@Injectable()
export class WebSearchSkill implements Skill {
  private readonly logger = new Logger(WebSearchSkill.name);

  readonly name = 'web_search';
  readonly description =
    'Search the web via Tavily Search API (free tier) and return a short summary with source links (optional Hugging Face Hub enrichment for model queries).';
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

    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      return {
        success: false,
        output:
          'Search error: TAVILY_API_KEY is not set. Sign up free at https://tavily.com (1,000 searches/month, no credit card) and add your API key.',
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

      const tavily = await this.tavilyWebSearch(query, apiKey, timeoutMs);
      const lines = [...formatSearchHits(tavily.hits)];

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
        const detail = `[provider=tavily status=${tavily.status} hits=0${tavily.error ? ` error=${tavily.error}` : ''}]`;
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

  private async tavilyWebSearch(
    query: string,
    apiKey: string,
    timeoutMs: number,
  ): Promise<{ hits: SearchHit[]; status: number; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(TAVILY_SEARCH_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'basic',
          include_answer: false,
          max_results: 8,
        }),
      });

      const body = await response.text();
      if (!response.ok) {
        const snippet = body.slice(0, 200).replace(/\s+/g, ' ').trim();
        throw new Error(
          `Tavily Search HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`,
        );
      }

      let parsed: TavilySearchResponse;
      try {
        parsed = JSON.parse(body) as TavilySearchResponse;
      } catch {
        throw new Error('Tavily Search returned invalid JSON');
      }

      const hits = mapTavilyResults(parsed.results ?? []);
      return { hits, status: response.status };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Timed out after ${timeoutMs}ms calling Tavily Search`);
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
