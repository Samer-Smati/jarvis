import { BadRequestException } from '@nestjs/common';
import { assertValidConversationId, isValidConversationId } from './conversation-id.util';

describe('conversation-id.util', () => {
  it('accepts legacy default', () => {
    expect(isValidConversationId('default')).toBe(true);
    expect(assertValidConversationId('default')).toBe('default');
  });

  it('accepts daily ids', () => {
    expect(isValidConversationId('daily-2026-07-29')).toBe(true);
    expect(assertValidConversationId('daily-2026-07-29')).toBe('daily-2026-07-29');
  });

  it('rejects malformed ids', () => {
    expect(isValidConversationId('daily-2026-7-29')).toBe(false);
    expect(isValidConversationId('default-old')).toBe(false);
    expect(isValidConversationId('thread-1')).toBe(false);
    expect(() => assertValidConversationId('bad-id')).toThrow(BadRequestException);
  });

  it('rejects missing ids', () => {
    expect(() => assertValidConversationId(undefined)).toThrow(BadRequestException);
    expect(() => assertValidConversationId('   ')).toThrow(BadRequestException);
  });
});
