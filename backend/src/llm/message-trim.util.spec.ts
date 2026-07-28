import type { ChatMessage } from './llm.types';
import {
  estimateChatChars,
  providerCanAcceptMessages,
  providerInputCharCap,
  trimMessagesForLlm,
} from './message-trim.util';

describe('message-trim.util', () => {
  const system: ChatMessage = { role: 'system', content: 'x'.repeat(2000) };
  const history: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${i} `.repeat(200),
  }));

  it('caps groq-bound payloads', () => {
    const messages = [system, ...history];
    const trimmed = trimMessagesForLlm(messages, providerInputCharCap('groq'));
    expect(estimateChatChars(trimmed)).toBeLessThanOrEqual(providerInputCharCap('groq'));
    expect(trimmed[0]?.role).toBe('system');
  });

  it('truncates large tool outputs', () => {
    const messages: ChatMessage[] = [
      system,
      { role: 'tool', content: 'y'.repeat(20_000), toolCallId: '1', toolName: 'self_improve' },
    ];
    const trimmed = trimMessagesForLlm(messages, 25_000);
    expect(trimmed[1]?.content?.length ?? 0).toBeLessThan(20_000);
  });

  it('detects when groq cannot accept a payload', () => {
    const huge: ChatMessage[] = [{ role: 'user', content: 'z'.repeat(30_000) }];
    expect(providerCanAcceptMessages('groq', huge)).toBe(false);
    expect(providerCanAcceptMessages('gemini', huge)).toBe(true);
  });
});
