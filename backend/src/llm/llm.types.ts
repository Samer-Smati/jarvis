export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatImagePart {
  mimeType: string;
  data: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  images?: ChatImagePart[];
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Gemini-only: encrypted reasoning signature that must be echoed back on replay or the
   * OpenAI-compatible endpoint rejects the next turn with "missing a thought_signature". */
  thoughtSignature?: string;
}

export interface LlmChatOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  onThinking?: (token: string) => void;
  route?: { provider?: string; model?: string; maxTokens?: number; timeoutMs?: number };
}

export interface LlmRouteContext {
  task?: string;
  reason?: string;
  provider?: string;
  model?: string;
}

export interface LlmChatResult {
  content: string;
  toolCalls: ToolCall[];
}

export interface LlmProvider {
  readonly name: string;
  chat(options: LlmChatOptions): Promise<LlmChatResult>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
