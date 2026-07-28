import { ToolCall, ToolDefinition } from '../llm/llm.types';

export function normalizeToolCalls(
  streamed: ToolCall[],
  content: string,
  definitions: ToolDefinition[],
): ToolCall[] {
  const known = new Set(definitions.map((d) => d.name));
  const parsed = parseTextToolCalls(content);
  const merged = [...streamed, ...parsed];
  const byName = new Map<string, ToolCall>();

  for (const call of merged) {
    const name = aliasToCanonical(call.name, known);
    if (!known.has(name)) {
      continue;
    }
    byName.set(name, {
      id: call.id || `call_${name}_${byName.size}`,
      name,
      arguments: sanitizeArgs(call.arguments),
    });
  }

  return [...byName.values()];
}

export function normalizeToolDefinitions(definitions: ToolDefinition[]): ToolDefinition[] {
  return definitions.map((def) => ({
    name: def.name,
    description: def.description.trim(),
    parameters: {
      type: 'object',
      properties: def.parameters?.properties ?? {},
      required: def.parameters?.required ?? [],
    },
  }));
}

function aliasToCanonical(name: string, known: Set<string>): string {
  const trimmed = name.trim();
  if (known.has(trimmed)) {
    return trimmed;
  }
  const aliases: Record<string, string> = {
    remember: 'remember_fact',
    weather: 'get_weather',
    search: 'web_search',
    datetime: 'get_current_datetime',
  };
  return aliases[trimmed] ?? trimmed;
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function parseTextToolCalls(content: string): ToolCall[] {
  const pattern = /<function=([^>]+)>([\s\S]*?)<\/function>/gi;
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const name = match[1]?.trim();
    if (!name) {
      continue;
    }
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(match[2]?.trim() || '{}') as Record<string, unknown>;
    } catch {
      args = {};
    }
    calls.push({ id: `text_${calls.length}`, name, arguments: args });
  }
  return calls;
}
