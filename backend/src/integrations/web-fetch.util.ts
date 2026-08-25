export const DEFAULT_MAX_RAW_BYTES = 512_000;
export const MAX_TEXT_CHARS = 32_000;
export const MIN_USEFUL_TEXT_CHARS = 400;

export function resolveMaxRawBytes(): number {
  const raw = process.env.JARVIS_FETCH_MAX_BYTES?.trim();
  if (!raw) {
    return DEFAULT_MAX_RAW_BYTES;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RAW_BYTES;
}

export async function readResponseBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) {
    const full = new Uint8Array(await response.arrayBuffer());
    if (full.length <= maxBytes) {
      return { bytes: full, truncated: false };
    }
    return { bytes: full.slice(0, maxBytes), truncated: true };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (total + value.length > maxBytes) {
        const take = maxBytes - total;
        if (take > 0) {
          chunks.push(value.slice(0, take));
          total += take;
        }
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes: merged, truncated };
}

export function stripHtmlBoilerplate(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
}

export function htmlToText(html: string): string {
  let text = stripHtmlBoilerplate(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1].replace(/\s+/g, ' ').trim()) : '';
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
