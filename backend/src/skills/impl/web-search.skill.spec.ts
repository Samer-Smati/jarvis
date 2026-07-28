import { parseDuckDuckGoLiteHtml } from './web-search.skill';

describe('parseDuckDuckGoLiteHtml', () => {
  it('extracts result-link anchors from lite HTML', () => {
    const html =
      "<a rel=\"nofollow\" href=\"//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F\" class='result-link'>Example title</a>";
    const hits = parseDuckDuckGoLiteHtml(html);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe('Example title');
    expect(hits[0]?.url).toContain('example.com');
  });
});
