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
}

export interface LlmChatOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  /** Stream model reasoning / chain-of-thought when the provider exposes it. */
  onThinking?: (token: string) => void;
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
