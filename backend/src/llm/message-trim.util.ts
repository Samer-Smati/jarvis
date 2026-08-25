import type { ChatMessage } from './llm.types';

const PROVIDER_INPUT_CHAR_CAPS: Record<string, number> = {
  groq: 18_000,
  ollama: 80_000,
  lmstudio: 80_000,
};

const DEFAULT_INPUT_CHAR_CAP = 120_000;
const MAX_TOOL_MESSAGE_CHARS = 6_000;
const MAX_ASSISTANT_MESSAGE_CHARS = 4_000;

export function providerInputCharCap(providerName: string): number {
  return PROVIDER_INPUT_CHAR_CAPS[providerName] ?? DEFAULT_INPUT_CHAR_CAP;
}

export function estimateChatChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + messageCharLength(m), 0);
}

export function trimMessagesForLlm(messages: ChatMessage[], maxChars: number): ChatMessage[] {
  if (maxChars <= 0 || messages.length === 0) {
    return messages;
  }

  const normalized = messages.map((m) => truncateMessage(m));
  if (estimateChatChars(normalized) <= maxChars) {
    return normalized;
  }

  const system = normalized[0]?.role === 'system' ? [normalized[0]] : [];
  const dialog = system.length ? normalized.slice(1) : normalized;
  const tail: ChatMessage[] = [];

  for (let i = dialog.length - 1; i >= 0; i--) {
    const candidate = [dialog[i], ...tail];
    const packed = [...system, ...candidate];
    if (estimateChatChars(packed) > maxChars) {
      break;
    }
    tail.unshift(dialog[i]);
  }

  if (tail.length) {
    return [...system, ...tail];
  }

  if (system.length) {
    const onlySystem = truncateContent(system[0], Math.max(512, maxChars - 256));
    return [onlySystem];
  }

  return [truncateContent(dialog[dialog.length - 1], maxChars)];
}

function messageCharLength(message: ChatMessage): number {
  let n = message.content?.length ?? 0;
  if (message.toolCalls?.length) {
    n += JSON.stringify(message.toolCalls).length;
  }
  if (message.images?.length) {
    n += message.images.length * 500;
  }
  return n;
}

function truncateMessage(message: ChatMessage): ChatMessage {
  if (message.role === 'tool') {
    return truncateContent(message, MAX_TOOL_MESSAGE_CHARS);
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    const content = message.content?.slice(0, MAX_ASSISTANT_MESSAGE_CHARS) ?? message.content;
    return { ...message, content };
  }
  if (message.role === 'assistant' && (message.content?.length ?? 0) > MAX_ASSISTANT_MESSAGE_CHARS) {
    return truncateContent(message, MAX_ASSISTANT_MESSAGE_CHARS);
  }
  return message;
}

function truncateContent(message: ChatMessage, maxChars: number): ChatMessage {
  const text = message.content ?? '';
  if (text.length <= maxChars) {
    return message;
  }
  const head = Math.max(256, Math.floor(maxChars * 0.65));
  const tail = Math.max(128, maxChars - head - 48);
  return {
    ...message,
    content: `${text.slice(0, head)}\n\n[…truncated ${text.length - head - tail} chars…]\n\n${text.slice(-tail)}`,
  };
}

export function providerCanAcceptMessages(providerName: string, messages: ChatMessage[]): boolean {
  return estimateChatChars(messages) <= providerInputCharCap(providerName);
}
