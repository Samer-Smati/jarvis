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

  /** Remove every jarvis.conversation.* entry and related recap flags from this browser. */
  clearAllLocal(): number {
    let removed = 0;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('jarvis.conversation.')) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      localStorage.removeItem(key);
      removed += 1;
    }
    try {
      const sessionKeys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith('jarvis.recapDone.')) {
          sessionKeys.push(key);
        }
      }
      for (const key of sessionKeys) {
        sessionStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
    return removed;
  }

  mergeApiAndLocal(api: StoredMessage[], local: PersistedMessage[]): PersistedMessage[] {
    const apiMapped = api
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt,
      }));

    // Merge API + local for the same conversationId only (never across days).
    const seen = new Set<string>();
    const merged: PersistedMessage[] = [];
    for (const message of [...apiMapped, ...local]) {
      const key = `${message.role}\0${message.content.trim()}`;
      if (!message.content?.trim() || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(message);
    }

    merged.sort((a, b) => {
      const aTime = Date.parse(a.createdAt) || 0;
      const bTime = Date.parse(b.createdAt) || 0;
      return aTime - bTime;
    });

    return merged.slice(-MAX_STORED);
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
