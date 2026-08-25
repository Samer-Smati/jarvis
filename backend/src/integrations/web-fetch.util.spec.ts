import { htmlToText, readResponseBodyCapped, stripHtmlBoilerplate } from './web-fetch.util';

describe('web-fetch.util', () => {
  it('strips script/style bulk so large HTML yields small readable text', () => {
    const scriptBlob = 'x'.repeat(900_000);
    const html = `<!doctype html><html><head><title>Skills</title><style>${scriptBlob}</style></head><body><h1>Agent Skills</h1><p>Directory of skills.</p><script>${scriptBlob}</script></body></html>`;
    expect(html.length).toBeGreaterThan(500_000);
    const stripped = stripHtmlBoilerplate(html);
    expect(stripped.length).toBeLessThan(500);
    const text = htmlToText(html);
    expect(text).toContain('Agent Skills');
    expect(text.length).toBeLessThan(200);
  });

  it('caps streamed response bodies without loading the full payload', async () => {
    const payload = new Uint8Array(700_000).fill(97);
    const response = new Response(payload, { headers: { 'content-type': 'text/plain' } });
    const { bytes, truncated } = await readResponseBodyCapped(response, 512_000);
    expect(bytes.length).toBe(512_000);
    expect(truncated).toBe(true);
  });
});
