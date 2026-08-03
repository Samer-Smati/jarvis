import {
  cappedRetryAfterMs,
  MAX_PROVIDER_RETRY_SLEEP_MS,
  parseRetryAfterMs,
} from './openai-stream.util';

describe('cappedRetryAfterMs', () => {
  it('parses try-again seconds', () => {
    expect(parseRetryAfterMs('Please try again in 12.5s')).toBe(12_500);
  });

  it('caps long rate-limit waits so chat can rotate providers', () => {
    expect(cappedRetryAfterMs('Please try again in 45s')).toBe(MAX_PROVIDER_RETRY_SLEEP_MS);
    expect(cappedRetryAfterMs('Please try again in 0.5s')).toBe(500);
  });
});
