import {
  buildWebSearchUnavailableMessage,
  isFailedWebSearchOutput,
  mapBraveResults,
  formatSearchHits,
} from './web-search.util';
import { WebSearchSkill } from './web-search.skill';

describe('web-search.util', () => {
  it('detects failed search output patterns', () => {
    expect(isFailedWebSearchOutput('Search error: HTTP 403')).toBe(true);
    expect(isFailedWebSearchOutput('No web results found for "x".')).toBe(true);
    expect(isFailedWebSearchOutput('- Example result (https://example.com)')).toBe(false);
  });

  it('builds a caution-first unavailable message', () => {
    const msg = buildWebSearchUnavailableMessage('Search error: HTTP 403');
    expect(msg.toLowerCase()).toContain("wasn't able to search");
    expect(msg.toLowerCase()).toContain('outdated');
  });

  it('maps Brave API rows to search hits', () => {
    const hits = mapBraveResults([
      { title: 'Example', url: 'https://example.com', description: 'Snippet text' },
    ]);
    expect(formatSearchHits(hits)[0]).toContain('Example');
    expect(formatSearchHits(hits)[0]).toContain('https://example.com');
  });
});

describe('WebSearchSkill', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.BRAVE_SEARCH_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.BRAVE_SEARCH_API_KEY;
    } else {
      process.env.BRAVE_SEARCH_API_KEY = originalKey;
    }
  });

  it('returns failure when BRAVE_SEARCH_API_KEY is missing', async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    const skill = new WebSearchSkill();
    const result = await skill.execute({ query: 'best llm 2026' }, { conversationId: 't' });
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/BRAVE_SEARCH_API_KEY/i);
  });

  it('returns Brave web results on success', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          web: {
            results: [
              {
                title: 'Best LLMs 2026',
                url: 'https://example.com/llm',
                description: 'Current rankings',
              },
            ],
          },
        }),
    }) as unknown as typeof fetch;

    const skill = new WebSearchSkill();
    const result = await skill.execute(
      { query: 'current news headlines' },
      { conversationId: 't' },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Best LLMs 2026');
    expect(result.output).toContain('https://example.com/llm');
    const braveCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(braveCall[0])).toContain('api.search.brave.com/res/v1/web/search');
    expect(braveCall[1]?.headers?.['X-Subscription-Token']).toBe('test-key');
  });

  it('surfaces Brave HTTP errors in output', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    }) as unknown as typeof fetch;

    const skill = new WebSearchSkill();
    const result = await skill.execute({ query: 'test' }, { conversationId: 't' });

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/Brave Search HTTP 403/i);
  });
});
