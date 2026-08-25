import { resolveChatRequestId } from './chat-request.util';

describe('resolveChatRequestId', () => {
  it('uses client-provided ids when present', () => {
    expect(resolveChatRequestId('client-req-1')).toBe('client-req-1');
  });

  it('generates a uuid when missing', () => {
    const id = resolveChatRequestId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
