import { ChatMessage, LlmChatOptions, LlmChatResult, ToolCall } from './llm.types';

export interface OpenAiStreamConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  providerLabel: string;
  extraHeaders?: Record<string, string>;
}

interface OpenAiMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
}

interface StreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }[];
}

export async function streamOpenAiChat(
  config: OpenAiStreamConfig,
  options: LlmChatOptions,
): Promise<LlmChatResult> {
  const body: Record<string, unknown> = {
    model: config.model,
    stream: true,
    messages: options.messages.map((m) => toOpenAiMessage(m)),
    tools: options.tools?.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })),
  };
  if (options.tools?.length) {
    body.tool_choice = 'auto';
  }

  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...config.extraHeaders,
    },
    body: JSON.stringify(body),
    signal: options.signal ?? null,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`${config.providerLabel} request failed (${response.status}): ${text}`);
  }

  let content = '';
  const toolCalls: ToolCall[] = [];
  const toolDrafts = new Map<number, { id: string; name: string; args: string }>();
  let suppressToolText = false;
  let toolTextBuffer = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        continue;
      }
      const chunk = JSON.parse(payload) as StreamChunk;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) {
        continue;
      }
      if (delta.content) {
        content += delta.content;
        if (suppressToolText) {
          toolTextBuffer += delta.content;
          if (toolTextBuffer.includes('</function>')) {
            suppressToolText = false;
            toolTextBuffer = '';
          }
        } else if (delta.content.includes('<function')) {
          const before = delta.content.split('<function')[0];
          if (before) {
            options.onToken?.(before);
          }
          suppressToolText = true;
          toolTextBuffer = delta.content.slice(delta.content.indexOf('<function'));
          if (toolTextBuffer.includes('</function>')) {
            suppressToolText = false;
            toolTextBuffer = '';
          }
        } else {
          options.onToken?.(delta.content);
        }
      }
      for (const tc of delta.tool_calls ?? []) {
        const draft = toolDrafts.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) {
          draft.id = tc.id;
        }
        if (tc.function?.name) {
          draft.name = tc.function.name;
        }
        if (tc.function?.arguments) {
          draft.args += tc.function.arguments;
        }
        toolDrafts.set(tc.index, draft);
      }
    }
  }

  for (const draft of toolDrafts.values()) {
    let args: Record<string, unknown> = {};
    try {
      args = draft.args ? (JSON.parse(draft.args) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    toolCalls.push({
      id: draft.id || `call_${toolCalls.length}_${Date.now()}`,
      name: draft.name,
      arguments: args,
    });
  }

  const parsed = parseTextToolCalls(content);
  content = parsed.content;
  for (const call of parsed.toolCalls) {
    if (!toolCalls.some((t) => t.name === call.name)) {
      toolCalls.push(call);
    }
  }

  return { content, toolCalls };
}

export async function listOpenAiModels(apiKey: string, baseUrl: string): Promise<Set<string>> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return new Set();
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    return new Set((payload.data ?? []).map((m) => m.id).filter(Boolean) as string[]);
  } catch {
    return new Set();
  }
}

export function resolveModelChain(
  preferred: string,
  fallbacks: string[],
  available: Set<string>,
  hardcodedFallbacks: string[],
): string[] {
  const chain = [preferred, ...fallbacks.filter((m) => m !== preferred)].filter(
    (m) => !available.size || available.has(m),
  );
  if (!chain.length) {
    for (const fallback of hardcodedFallbacks) {
      if (!available.size || available.has(fallback)) {
        chain.push(fallback);
      }
    }
  }
  if (!chain.length && available.size) {
    const first = [...available][0];
    if (first) {
      chain.push(first);
    }
  }
  if (!chain.length) {
    return [preferred, ...fallbacks.filter((m) => m !== preferred)];
  }
  return chain;
}

export function isRateLimitError(message: string): boolean {
  return message.includes('429') || message.includes('rate_limit');
}

export function isModelNotFoundError(message: string): boolean {
  return message.includes('404') || message.includes('model_not_found') || message.includes('does not exist');
}

export function parseRetryAfterMs(message: string): number | null {
  const secMatch = message.match(/try again in (\d+(?:\.\d+)?)s/i);
  if (secMatch?.[1]) {
    return Math.ceil(parseFloat(secMatch[1]) * 1000);
  }
  const retryMatch = message.match(/"retry-after"\s*:\s*(\d+)/i);
  if (retryMatch?.[1]) {
    return parseInt(retryMatch[1], 10) * 1000;
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toOpenAiMessage(message: ChatMessage): OpenAiMessage {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function parseTextToolCalls(content: string): { content: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  const cleaned = content
    .replace(/<function=([^>]+)>([\s\S]*?)<\/function>/gi, (_, name: string, argsRaw: string) => {
      let args: Record<string, unknown> = {};
      try {
        args = argsRaw?.trim() ? (JSON.parse(argsRaw.trim()) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      toolCalls.push({
        id: `text_call_${toolCalls.length}_${Date.now()}`,
        name: name.trim(),
        arguments: args,
      });
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { content: cleaned, toolCalls };
}
