import { ToolCall } from './llm.types';

const FUNCTION_BLOCK = /<function=([^>]+)>([\s\S]*?)<\/function>/gi;
const TOOL_CALL_BLOCK = /<tool_call>\s*([^\s<]+)([\s\S]*?)<\/tool_call>/gi;
const ARG_PAIR = /<arg_key>\s*([^<]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
const MARKUP_START = /<(?:tool_call|function=)/i;
const MARKUP_END = /<\/(?:tool_call|function)>/i;

export function containsRawToolCallMarkup(text: string): boolean {
  return MARKUP_START.test(text) || /<\/tool_call>/i.test(text) || /<arg_key>/i.test(text);
}

export function parseTextToolCallsFromContent(content: string): { content: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let cleaned = content;

  cleaned = cleaned.replace(FUNCTION_BLOCK, (_, name: string, argsRaw: string) => {
    toolCalls.push({
      id: `text_call_${toolCalls.length}_${Date.now()}`,
      name: name.trim(),
      arguments: parseFunctionArgs(argsRaw),
    });
    return ' ';
  });

  cleaned = cleaned.replace(TOOL_CALL_BLOCK, (_, name: string, body: string) => {
    toolCalls.push({
      id: `text_call_${toolCalls.length}_${Date.now()}`,
      name: name.trim(),
      arguments: parseArgKeyValueArgs(body),
    });
    return ' ';
  });

  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  return { content: cleaned, toolCalls };
}

export function stripRawToolCallMarkup(text: string): string {
  return text
    .replace(FUNCTION_BLOCK, ' ')
    .replace(TOOL_CALL_BLOCK, ' ')
    .replace(/<\/?tool_call>/gi, ' ')
    .replace(/<arg_key>[\s\S]*?<\/arg_value>/gi, ' ')
    .replace(/<function=[^>]*>/gi, ' ')
    .replace(/<\/function>/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function sanitizeUserFacingAssistantText(text: string): string {
  const stripped = stripRawToolCallMarkup(text);
  if (stripped.length >= 8) {
    return stripped;
  }
  if (containsRawToolCallMarkup(text)) {
    return 'Let me search for that, sir — one moment.';
  }
  return stripped;
}

export class ToolMarkupStreamFilter {
  private suppress = false;
  private buffer = '';

  feed(chunk: string, emit: (safe: string) => void): void {
    let rest = chunk;
    while (rest.length) {
      if (this.suppress) {
        this.buffer += rest;
        const end = this.findMarkupEnd(this.buffer);
        if (end >= 0) {
          rest = this.buffer.slice(end);
          this.buffer = '';
          this.suppress = false;
          continue;
        }
        return;
      }

      const start = this.findMarkupStart(rest);
      if (start < 0) {
        emit(rest);
        return;
      }

      if (start > 0) {
        emit(rest.slice(0, start));
      }

      this.suppress = true;
      this.buffer = rest.slice(start);
      rest = '';

      const end = this.findMarkupEnd(this.buffer);
      if (end >= 0) {
        rest = this.buffer.slice(end);
        this.buffer = '';
        this.suppress = false;
      }
    }
  }

  private findMarkupStart(text: string): number {
    const lower = text.toLowerCase();
    const toolIdx = lower.indexOf('<tool_call');
    const fnIdx = lower.indexOf('<function');
    if (toolIdx < 0) {
      return fnIdx;
    }
    if (fnIdx < 0) {
      return toolIdx;
    }
    return Math.min(toolIdx, fnIdx);
  }

  private findMarkupEnd(buffer: string): number {
    const lower = buffer.toLowerCase();
    const ends = ['</tool_call>', '</function>']
      .map((tag) => lower.indexOf(tag))
      .filter((idx) => idx >= 0);
    if (!ends.length) {
      return -1;
    }
    const idx = Math.min(...ends);
    const tag = lower.slice(idx).startsWith('</tool_call>') ? '</tool_call>' : '</function>';
    return idx + tag.length;
  }
}

function parseFunctionArgs(argsRaw: string): Record<string, unknown> {
  try {
    return argsRaw?.trim() ? (JSON.parse(argsRaw.trim()) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseArgKeyValueArgs(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const match of body.matchAll(ARG_PAIR)) {
    const key = match[1]?.trim();
    const value = match[2]?.trim();
    if (key) {
      args[key] = value ?? '';
    }
  }
  if (Object.keys(args).length) {
    return args;
  }
  const jsonMatch = body.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}
