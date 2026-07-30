import { ChatMessage } from './models';

export interface OutboundChatRequest {
  requestId: string;
  text: string;
  history: Array<{ role: string; content: string; createdAt?: string }>;
  images: Array<{ mimeType: string; data: string }>;
}

export function createChatRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isEventForRequest(
  eventRequestId: string | undefined,
  targetRequestId: string | undefined,
): boolean {
  if (!eventRequestId || !targetRequestId) {
    return false;
  }
  return eventRequestId === targetRequestId;
}

export function findAssistantIndex(messages: ChatMessage[], requestId: string): number {
  return messages.findIndex((m) => m.role === 'assistant' && m.requestId === requestId);
}

export function findUserIndex(messages: ChatMessage[], requestId: string): number {
  return messages.findIndex((m) => m.role === 'user' && m.requestId === requestId);
}

/**
 * Applies a completed assistant response to the message paired with requestId.
 * Returns false when the event belongs to another in-flight or stale request.
 */
export function applyAssistantCompletion(
  messages: ChatMessage[],
  requestId: string,
  finalText: string,
  interactionId?: string,
): boolean {
  const index = findAssistantIndex(messages, requestId);
  if (index < 0) {
    return false;
  }
  const assistant = messages[index];
  assistant.content = finalText || assistant.content;
  assistant.streaming = false;
  assistant.statusHint = undefined;
  assistant.interactionId = interactionId;
  assistant.pending = false;
  return true;
}

export const EMPTY_ASSISTANT_REPLY_MESSAGE =
  'The request finished without a visible reply, sir — please retry.';

/**
 * Empty done events must never delete the assistant bubble — fill a retryable failure instead.
 */
export function resolveEmptyAssistantDone(
  messages: ChatMessage[],
  requestId: string,
): { filled: boolean; message: string } {
  const index = findAssistantIndex(messages, requestId);
  if (index < 0) {
    return { filled: false, message: EMPTY_ASSISTANT_REPLY_MESSAGE };
  }
  const assistant = messages[index];
  if (assistant.content?.trim()) {
    return { filled: false, message: assistant.content };
  }
  assistant.content = EMPTY_ASSISTANT_REPLY_MESSAGE;
  assistant.streaming = false;
  assistant.statusHint = undefined;
  return { filled: true, message: EMPTY_ASSISTANT_REPLY_MESSAGE };
}

/**
 * Regression helper: simulates two turns where the first response arrives after the second.
 * Each assistant bubble must retain the answer tied to its requestId.
 */
export function simulateDelayedResponseSwap(
  firstQuestion: string,
  secondQuestion: string,
  firstAnswer: string,
  secondAnswer: string,
): { messages: ChatMessage[]; swapped: boolean } {
  const firstId = 'req-first';
  const secondId = 'req-second';
  const messages: ChatMessage[] = [
    { role: 'user', content: firstQuestion, requestId: firstId },
    { role: 'assistant', content: '', streaming: true, requestId: firstId, tools: [] },
    { role: 'user', content: secondQuestion, requestId: secondId },
    { role: 'assistant', content: '', streaming: true, requestId: secondId, tools: [] },
  ];

  applyAssistantCompletion(messages, secondId, secondAnswer);
  applyAssistantCompletion(messages, firstId, firstAnswer);

  const firstAssistant = messages[findAssistantIndex(messages, firstId)];
  const secondAssistant = messages[findAssistantIndex(messages, secondId)];
  const swapped =
    firstAssistant.content === secondAnswer || secondAssistant.content === firstAnswer;

  return { messages, swapped };
}
