import {
  cappedRetryAfterMs,
  MAX_PROVIDER_RETRY_SLEEP_MS,
  parseRetryAfterMs,
  streamOpenAiChat,
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

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < lines.length) {
        controller.enqueue(encoder.encode(`${lines[i]}\n`));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

describe('streamOpenAiChat Gemini thought_signature round-trip', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const config = {
    apiKey: 'k',
    baseUrl: 'https://example.com',
    model: 'gemini-flash-latest',
    providerLabel: 'Gemini',
  };

  it('captures the thought_signature carried on a streamed tool_call delta', async () => {
    const signature = 'EpoECpcEARFNMg...';
    const chunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: 'get_weather', arguments: '{"city":"Tunis"}' },
                extra_content: { google: { thought_signature: signature } },
              },
            ],
          },
        },
      ],
    };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: sseStream([`data: ${JSON.stringify(chunk)}`, 'data: [DONE]']),
    } as unknown as Response);

    const result = await streamOpenAiChat(config, {
      messages: [{ role: 'user', content: 'weather?' }],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].thoughtSignature).toBe(signature);
  });

  it('echoes the thought_signature back on the outgoing assistant tool_calls', async () => {
    const signature = 'sig-abc';
    let capturedBody: { messages: Array<Record<string, unknown>> } | undefined;
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(String((init as RequestInit).body));
      return { ok: true, body: sseStream(['data: [DONE]']) } as unknown as Response;
    });

    await streamOpenAiChat(config, {
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'get_weather',
              arguments: { city: 'Tunis' },
              thoughtSignature: signature,
            },
          ],
        },
        { role: 'tool', content: '72F', toolCallId: 'call_1', toolName: 'get_weather' },
      ],
    });

    const assistantMessage = capturedBody?.messages.find((m) => m.role === 'assistant') as {
      tool_calls: Array<{ extra_content?: { google?: { thought_signature?: string } } }>;
    };
    expect(assistantMessage.tool_calls[0].extra_content?.google?.thought_signature).toBe(
      signature,
    );
  });
});
