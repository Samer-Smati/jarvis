import { BadRequestException } from '@nestjs/common';

export const LEGACY_CONVERSATION_ID = 'default';
export const DAILY_CONVERSATION_ID_PATTERN = /^daily-\d{4}-\d{2}-\d{2}$/;

export function isValidConversationId(id: string): boolean {
  const trimmed = id.trim();
  return trimmed === LEGACY_CONVERSATION_ID || DAILY_CONVERSATION_ID_PATTERN.test(trimmed);
}

export function assertValidConversationId(raw: string | undefined): string {
  const id = raw?.trim();
  if (!id) {
    throw new BadRequestException(
      'conversationId is required. Use "default" or daily-YYYY-MM-DD (e.g. daily-2026-07-29).',
    );
  }
  if (!isValidConversationId(id)) {
    throw new BadRequestException(
      `Invalid conversationId "${id}". Use "default" or daily-YYYY-MM-DD (e.g. daily-2026-07-29).`,
    );
  }
  return id;
}
