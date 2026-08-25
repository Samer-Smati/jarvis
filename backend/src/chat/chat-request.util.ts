import { randomUUID } from 'node:crypto';

export function resolveChatRequestId(raw?: string): string {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length <= 128 ? trimmed : randomUUID();
}
