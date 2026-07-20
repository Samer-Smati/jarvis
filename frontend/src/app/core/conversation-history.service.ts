import { Injectable } from '@angular/core';
import { StoredMessage } from './models';

export interface PersistedMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

const MAX_STORED = 500;

@Injectable({ providedIn: 'root' })
export class ConversationHistoryService {
  load(conversationId: string): PersistedMessage[] {
    try {
      const raw = localStorage.getItem(this.storageKey(conversationId));
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as PersistedMessage[];
      return Array.isArray(parsed) ? parsed.filter((m) => m.content?.trim()) : [];
    } catch {
      return [];
    }
  }

  save(conversationId: string, messages: PersistedMessage[]): void {
    const trimmed = messages.filter((m) => m.content?.trim()).slice(-MAX_STORED);
    localStorage.setItem(this.storageKey(conversationId), JSON.stringify(trimmed));
  }

  mergeApiAndLocal(api: StoredMessage[], local: PersistedMessage[]): PersistedMessage[] {
    const apiMapped = api
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt,
      }));

    if (apiMapped.length >= local.length) {
      return apiMapped;
    }
    return local;
  }

  toPersisted(messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt?: string }>): PersistedMessage[] {
    return messages
      .filter((m) => m.content?.trim())
      .map((m) => ({
        role: m.role,
        content: m.content.trim(),
        createdAt: m.createdAt ?? new Date().toISOString(),
      }));
  }

  private storageKey(conversationId: string): string {
    return `jarvis.conversation.${conversationId}`;
  }
}
