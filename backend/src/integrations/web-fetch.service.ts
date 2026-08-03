import { Injectable } from '@nestjs/common';
import {
  extractTitle,
  htmlToText,
  MAX_TEXT_CHARS,
  MIN_USEFUL_TEXT_CHARS,
  readResponseBodyCapped,
  resolveMaxRawBytes,
} from './web-fetch.util';

const FETCH_TIMEOUT_MS = 20_000;
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';
const USER_AGENT = 'JARVIS/1.0 (+https://github.com/Samer-Smati/jarvis)';

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  truncated?: boolean;
  source?: 'direct' | 'tavily';
}

interface TavilyExtractResult {
  url?: string;
  raw_content?: string;
  content?: string;
}

interface TavilyExtractResponse {
  results?: TavilyExtractResult[];
  failed_results?: Array<{ url?: string; error?: string }>;
}

export interface FetchedRawText {
  url: string;
  text: string;
  status: number;
}

@Injectable()
export class WebFetchService {
  async fetchReadable(rawUrl: string): Promise<FetchedPage> {
    const url = validatePublicHttpUrl(rawUrl);
    const direct = await this.fetchDirect(url);
    if (direct.text.length >= MIN_USEFUL_TEXT_CHARS) {
      return direct;
    }

    const tavilyKey = process.env.TAVILY_API_KEY?.trim();
    if (!tavilyKey) {
      return direct;
    }

    try {
      const extracted = await this.tavilyExtract(url.toString(), tavilyKey);
      if (!extracted.text.trim()) {
        return direct;
      }
      return {
        url: url.toString(),
        title: extracted.title || direct.title || url.hostname,
        text: extracted.text.slice(0, MAX_TEXT_CHARS),
        truncated: extracted.text.length > MAX_TEXT_CHARS,
        source: 'tavily',
      };
    } catch {
      return direct;
    }
  }

  /** Plain GET for raw markdown/text (e.g. raw.githubusercontent.com). No HTML→text, no Tavily. */
  async fetchRawText(rawUrl: string): Promise<FetchedRawText> {
    const url = validatePublicHttpUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'text/plain, text/markdown, */*',
          'User-Agent': USER_AGENT,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url.toString()}`);
      }

      const maxRawBytes = resolveMaxRawBytes();
      const { bytes } = await readResponseBodyCapped(response, maxRawBytes);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();

      return {
        url: url.toString(),
        text: text.slice(0, MAX_TEXT_CHARS),
        status: response.status,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchDirect(url: URL): Promise<FetchedPage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'User-Agent': USER_AGENT,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url.toString()}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const maxRawBytes = resolveMaxRawBytes();
      const { bytes, truncated } = await readResponseBodyCapped(response, maxRawBytes);
      const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const text = contentType.includes('html') ? htmlToText(raw) : raw.trim();
      const title = contentType.includes('html') ? extractTitle(raw) : url.hostname;

      return {
        url: url.toString(),
        title: title || url.hostname,
        text: text.slice(0, MAX_TEXT_CHARS),
        truncated: truncated || text.length > MAX_TEXT_CHARS,
        source: 'direct',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async tavilyExtract(
    url: string,
    apiKey: string,
  ): Promise<{ title: string; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(TAVILY_EXTRACT_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          api_key: apiKey,
          urls: [url],
          extract_depth: 'basic',
          format: 'text',
        }),
      });

      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Tavily Extract HTTP ${response.status}`);
      }

      let parsed: TavilyExtractResponse;
      try {
        parsed = JSON.parse(body) as TavilyExtractResponse;
      } catch {
        throw new Error('Tavily Extract returned invalid JSON');
      }

      const row = parsed.results?.[0];
      const text = String(row?.raw_content ?? row?.content ?? '').trim();
      return { title: '', text };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function validatePublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error('Private or local URLs are not allowed.');
  }

  return parsed;
}
