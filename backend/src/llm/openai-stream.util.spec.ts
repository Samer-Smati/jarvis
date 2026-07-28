import { isDailyQuotaExhaustedError } from './openai-stream.util';

describe('isDailyQuotaExhaustedError', () => {
  it('detects OpenRouter free-models-per-day cap', () => {
    const msg =
      'OpenRouter request failed (429): {"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits"}}';
    expect(isDailyQuotaExhaustedError(msg)).toBe(true);
  });

  it('does not treat transient 429 as daily quota', () => {
    expect(isDailyQuotaExhaustedError('Groq request failed (429): tokens per minute')).toBe(false);
  });
});
