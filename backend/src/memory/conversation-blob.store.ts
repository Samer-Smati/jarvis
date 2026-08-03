import { randomUUID } from 'node:crypto';
import { del, list, put } from '@vercel/blob';

export interface BlobMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}

function blobPath(conversationId: string): string {
  return `jarvis/conversations/${conversationId}.json`;
}

export class ConversationBlobStore {
  enabled(): boolean {
    return !!process.env.BLOB_READ_WRITE_TOKEN;
  }

  async load(conversationId: string): Promise<BlobMessage[]> {
    if (!this.enabled()) {
      return [];
    }
    try {
      const pathname = blobPath(conversationId);
      const { blobs } = await list({ prefix: pathname, limit: 5 });
      const match = blobs.find((b) => b.pathname === pathname) ?? blobs[0];
      if (!match?.url) {
        return [];
      }
      const res = await fetch(match.url);
      if (!res.ok) {
        return [];
      }
      const data = (await res.json()) as BlobMessage[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async save(conversationId: string, messages: BlobMessage[]): Promise<void> {
    if (!this.enabled()) {
      return;
    }
    await put(blobPath(conversationId), JSON.stringify(messages), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  }

  async append(conversationId: string, role: string, content: string): Promise<void> {
    const messages = await this.load(conversationId);
    messages.push({
      id: randomUUID(),
      conversationId,
      role,
      content,
      createdAt: new Date().toISOString(),
    });
    await this.save(conversationId, messages);
  }

  async replace(
    conversationId: string,
    items: Array<{ role: string; content: string; createdAt?: string }>,
  ): Promise<void> {
    const messages = items.map((m) => ({
      id: randomUUID(),
      conversationId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt ?? new Date().toISOString(),
    }));
    await this.save(conversationId, messages);
  }

  /** Delete every conversation blob under jarvis/conversations/. */
  async deleteAll(): Promise<number> {
    if (!this.enabled()) {
      return 0;
    }
    let deleted = 0;
    let cursor: string | undefined;
    do {
      const page = await list({
        prefix: 'jarvis/conversations/',
        cursor,
        limit: 100,
      });
      const urls = page.blobs.map((b) => b.url).filter(Boolean);
      if (urls.length) {
        await del(urls);
        deleted += urls.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return deleted;
  }
}
