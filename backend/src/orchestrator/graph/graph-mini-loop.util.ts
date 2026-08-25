import type { ChatMessage, LlmChatResult, ToolCall, ToolDefinition } from '../../llm/llm.types';

/** Total LLM turns per node. Last turn is reserved for JSON (no tools). */
export const MAX_NODE_ITERATIONS = 5;

export const FINAL_JSON_USER_PROMPT = [
  'FINAL ITERATION: Do not call any tools.',
  'Using only the tool evidence already in this conversation, respond with ONLY the required JSON object.',
  'No prose, no markdown fences if you can avoid them — a single JSON object.',
].join(' ');

export function extractJsonObject(text: string): unknown | null {
  const raw = text.trim();
  if (!raw) {
    return null;
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface GraphMiniLoopDeps {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
  deadlineAt: number;
  maxIterations?: number;
  chat: (messages: ChatMessage[], tools: ToolDefinition[]) => Promise<LlmChatResult>;
  runTool: (call: ToolCall) => Promise<{ output: string; stopNode?: boolean; stopReason?: string }>;
}

export interface GraphMiniLoopResult {
  ok: boolean;
  reason?: string;
  assistantText: string;
  parsed: unknown | null;
}

export async function runGraphMiniLoop(deps: GraphMiniLoopDeps): Promise<GraphMiniLoopResult> {
  const maxIterations = Math.max(2, deps.maxIterations ?? MAX_NODE_ITERATIONS);
  const messages: ChatMessage[] = [
    { role: 'system', content: deps.systemPrompt },
    { role: 'user', content: deps.userPrompt },
  ];
  let lastContent = '';

  for (let i = 0; i < maxIterations; i++) {
    if (Date.now() > deps.deadlineAt) {
      return {
        ok: false,
        reason: 'Node deadline exceeded before finishing the mini tool-loop.',
        assistantText: lastContent,
        parsed: null,
      };
    }

    const isFinalIteration = i === maxIterations - 1;
    if (isFinalIteration) {
      messages.push({ role: 'user', content: FINAL_JSON_USER_PROMPT });
    }

    const turnTools = isFinalIteration ? [] : deps.tools;
    const result = await deps.chat(messages, turnTools);
    lastContent = result.content || '';

    if (!result.toolCalls.length) {
      const parsed = extractJsonObject(lastContent);
      if (!parsed || typeof parsed !== 'object') {
        return {
          ok: false,
          reason: isFinalIteration
            ? 'Node failed on final iteration: assistant did not return valid structured JSON.'
            : 'Node failed: assistant did not return valid structured JSON.',
          assistantText: lastContent,
          parsed: null,
        };
      }
      return { ok: true, assistantText: lastContent, parsed };
    }

    if (isFinalIteration) {
      return {
        ok: false,
        reason: 'Node failed on final iteration: tools were requested instead of JSON.',
        assistantText: lastContent,
        parsed: null,
      };
    }

    messages.push({
      role: 'assistant',
      content: result.content,
      toolCalls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const ran = await deps.runTool(call);
      messages.push({
        role: 'tool',
        content: ran.output,
        toolCallId: call.id,
        toolName: call.name,
      });
      if (ran.stopNode) {
        return {
          ok: false,
          reason: ran.stopReason ?? 'Tool allowlist stopped the node.',
          assistantText: lastContent,
          parsed: null,
        };
      }
    }
  }

  const parsed = extractJsonObject(lastContent);
  if (parsed && typeof parsed === 'object') {
    return { ok: true, assistantText: lastContent, parsed };
  }
  return {
    ok: false,
    reason: `Node exhausted ${maxIterations} iterations without valid JSON.`,
    assistantText: lastContent,
    parsed: null,
  };
}
