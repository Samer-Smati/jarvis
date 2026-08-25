import { ConversationSessionService } from './conversation-session.service';

describe('ConversationSessionService', () => {
  let service: ConversationSessionService;

  beforeEach(() => {
    service = new ConversationSessionService();
    localStorage.clear();
  });

  it('builds daily id from local calendar date via Intl', () => {
    const id = service.todayConversationId(new Date(2026, 6, 29, 15, 30));
    expect(id).toBe('daily-2026-07-29');
  });

  it('rotates stored id to today when date changes', () => {
    localStorage.setItem('jarvis.activeConversationId', 'daily-2026-07-28');
    const id = service.resolveActiveConversationId(new Date(2026, 6, 29, 8, 0));
    expect(id).toBe('daily-2026-07-29');
    expect(localStorage.getItem('jarvis.activeConversationId')).toBe('daily-2026-07-29');
  });

  it('keeps today id when already current', () => {
    localStorage.setItem('jarvis.activeConversationId', 'daily-2026-07-29');
    const id = service.resolveActiveConversationId(new Date(2026, 6, 29, 23, 59));
    expect(id).toBe('daily-2026-07-29');
  });

  it('replaces legacy default with today on resolve', () => {
    localStorage.setItem('jarvis.activeConversationId', 'default');
    const id = service.resolveActiveConversationId(new Date(2026, 6, 29, 9, 0));
    expect(id).toBe('daily-2026-07-29');
    expect(localStorage.getItem('jarvis.activeConversationId')).toBe('daily-2026-07-29');
  });
});
