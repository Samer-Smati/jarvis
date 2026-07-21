import { ChatMessage } from '../llm/llm.types';

export interface ClientHistoryMessage {
  role: string;
  content: string;
  createdAt?: string;
}

export function mergeClientHistory(
  dbHistory: ChatMessage[],
  clientHistory: ClientHistoryMessage[] | undefined,
  userText: string,
): ChatMessage[] {
  if (!clientHistory?.length) {
    return dbHistory;
  }

  const dialog = clientHistory.filter((m) => m.role === 'user' || m.role === 'assistant');
  const deduped = dedupeDialog(dialog);
  const clientTotal = deduped.length + 1;
  if (clientTotal <= dbHistory.length) {
    return dbHistory;
  }

  const merged: ChatMessage[] = deduped.slice(-200).map((m) => ({
    role: m.role as ChatMessage['role'],
    content: m.createdAt
      ? `[${formatMessageTimestamp(new Date(m.createdAt))}] ${m.content}`
      : m.content,
  }));

  const last = merged[merged.length - 1];
  const lastText = last?.content.replace(/^\[[^\]]+\]\s*/, '') ?? '';
  if (last?.role !== 'user' || lastText !== userText) {
    merged.push({ role: 'user', content: userText });
  }
  return merged;
}

function dedupeDialog(messages: ClientHistoryMessage[]): ClientHistoryMessage[] {
  const out: ClientHistoryMessage[] = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.role === msg.role &&
      prev.content.trim() === msg.content.trim()
    ) {
      continue;
    }
    out.push(msg);
  }
  return out;
}

function formatMessageTimestamp(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
