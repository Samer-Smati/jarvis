import { Injectable } from '@angular/core';

export const LEGACY_CONVERSATION_ID = 'default';
export const DAILY_CONVERSATION_ID_PATTERN = /^daily-\d{4}-\d{2}-\d{2}$/;

const ACTIVE_ID_STORAGE_KEY = 'jarvis.activeConversationId';

@Injectable({ providedIn: 'root' })
export class ConversationSessionService {
  todayConversationId(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
    const month = parts.find((p) => p.type === 'month')?.value ?? '01';
    const day = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `daily-${year}-${month}-${day}`;
  }

  resolveActiveConversationId(now = new Date()): string {
    const today = this.todayConversationId(now);
    const stored = this.readStoredId();
    if (stored === today) {
      return today;
    }
    this.writeStoredId(today);
    return today;
  }

  readActiveConversationId(): string | null {
    const stored = this.readStoredId();
    return stored && this.isValidConversationId(stored) ? stored : null;
  }

  isValidConversationId(id: string): boolean {
    const trimmed = id.trim();
    return trimmed === LEGACY_CONVERSATION_ID || DAILY_CONVERSATION_ID_PATTERN.test(trimmed);
  }

  recapSessionKey(conversationId: string): string {
    return `jarvis.recapDone.${conversationId}`;
  }

  private readStoredId(): string | null {
    try {
      const raw = localStorage.getItem(ACTIVE_ID_STORAGE_KEY)?.trim();
      return raw || null;
    } catch {
      return null;
    }
  }

  private writeStoredId(id: string): void {
    try {
      localStorage.setItem(ACTIVE_ID_STORAGE_KEY, id);
    } catch {
      /* ignore quota / private mode */
    }
  }
}
