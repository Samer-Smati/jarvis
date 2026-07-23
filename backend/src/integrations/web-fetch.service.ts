import { Injectable } from '@nestjs/common';

const MAX_BODY_BYTES = 512_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 48_000;

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
}

@Injectable()
export class WebFetchService {
  async fetchReadable(rawUrl: string): Promise<FetchedPage> {
    const url = validatePublicHttpUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'User-Agent': 'JARVIS/1.0 (+https://github.com/Samer-Smati/jarvis)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url.toString()}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_BODY_BYTES) {
        throw new Error(`Page too large (${buffer.byteLength} bytes). Max ${MAX_BODY_BYTES}.`);
      }

      const raw = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      const text = contentType.includes('html') ? htmlToText(raw) : raw.trim();
      const title = contentType.includes('html') ? extractTitle(raw) : url.hostname;

      return {
        url: url.toString(),
        title: title || url.hostname,
        text: text.slice(0, MAX_TEXT_CHARS),
      };
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

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1].replace(/\s+/g, ' ').trim()) : '';
}

function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}
