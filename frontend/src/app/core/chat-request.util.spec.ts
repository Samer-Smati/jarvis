import {
  applyAssistantCompletion,
  createChatRequestId,
  EMPTY_ASSISTANT_REPLY_MESSAGE,
  findAssistantIndex,
  isEventForRequest,
  resolveEmptyAssistantDone,
  simulateDelayedResponseSwap,
} from './chat-request.util';

describe('chat-request.util', () => {
  it('creates unique request ids', () => {
    const a = createChatRequestId();
    const b = createChatRequestId();
    expect(a).toBeTruthy();
    expect(b).not.toEqual(a);
  });

  it('matches events only for the same request id', () => {
    expect(isEventForRequest('a', 'a')).toBe(true);
    expect(isEventForRequest('a', 'b')).toBe(false);
    expect(isEventForRequest(undefined, 'a')).toBe(false);
  });

  it('does not apply completion to the wrong assistant bubble', () => {
    const messages = [
      { role: 'user' as const, content: 'Q1', requestId: 'r1' },
      { role: 'assistant' as const, content: '', streaming: true, requestId: 'r1' },
      { role: 'user' as const, content: 'Q2', requestId: 'r2' },
      { role: 'assistant' as const, content: '', streaming: true, requestId: 'r2' },
    ];

    expect(applyAssistantCompletion(messages, 'r2', 'Answer B')).toBe(true);
    expect(messages[findAssistantIndex(messages, 'r1')].content).toBe('');
    expect(messages[findAssistantIndex(messages, 'r2')].content).toBe('Answer B');

    expect(applyAssistantCompletion(messages, 'r1', 'Answer A')).toBe(true);
    expect(messages[findAssistantIndex(messages, 'r1')].content).toBe('Answer A');
    expect(messages[findAssistantIndex(messages, 'r2')].content).toBe('Answer B');
  });

  it('keeps each delayed response under its own question when the first finishes last', () => {
    const { messages, swapped } = simulateDelayedResponseSwap(
      'Tell me about PR #4',
      'Browse skills.sh',
      'PR #4 adds crypto monitor with Postgres.',
      'I ingested skills.sh into the brain.',
    );

    expect(swapped).toBe(false);
    expect(messages[1].content).toContain('PR #4');
    expect(messages[3].content).toContain('skills.sh');
  });

  it('keeps an empty assistant bubble with a retryable failure instead of removing it', () => {
    const messages = [
      { role: 'user' as const, content: 'Q', requestId: 'r1' },
      { role: 'assistant' as const, content: '', streaming: true, requestId: 'r1' },
    ];

    const result = resolveEmptyAssistantDone(messages, 'r1');

    expect(result.filled).toBe(true);
    expect(messages.length).toBe(2);
    expect(messages[1].content).toBe(EMPTY_ASSISTANT_REPLY_MESSAGE);
    expect(messages[1].streaming).toBe(false);
  });
});
