import { WebFetchService } from './web-fetch.service';

describe('WebFetchService.fetchRawText', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns raw text without HTML conversion and throws on non-2xx', async () => {
    const service = new WebFetchService();
    global.fetch = jest.fn().mockResolvedValue(
      new Response('---\nname: x\ndescription: y\n---\n\n# Title\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const ok = await service.fetchRawText(
      'https://raw.githubusercontent.com/obra/superpowers/main/skills/executing-plans/SKILL.md',
    );
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('name: x');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('raw.githubusercontent.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'text/plain, text/markdown, */*',
        }),
      }),
    );

    global.fetch = jest.fn().mockResolvedValue(new Response('missing', { status: 404 }));
    await expect(
      service.fetchRawText(
        'https://raw.githubusercontent.com/obra/superpowers/main/skills/nope/SKILL.md',
      ),
    ).rejects.toThrow(/HTTP 404/);
  });
});
