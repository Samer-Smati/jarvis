import { describeLlmNetworkError } from './llm-network-error';

describe('describeLlmNetworkError', () => {
  it('rewrites fetch failed into an actionable offline message', () => {
    const result = describeLlmNetworkError(
      new Error('fetch failed'),
      'LM Studio',
      'Start LM Studio and load a chat model.',
    );
    expect(result).toContain('LM Studio is offline');
    expect(result).toContain('Start LM Studio');
  });

  it('rewrites connection refused errors', () => {
    const result = describeLlmNetworkError(
      new Error('connect ECONNREFUSED 127.0.0.1:1234'),
      'Ollama',
      'Run: ollama serve',
    );
    expect(result).toContain('Ollama is offline');
    expect(result).toContain('ollama serve');
  });

  it('keeps unrelated error messages intact', () => {
    const result = describeLlmNetworkError(
      new Error('model not found'),
      'LM Studio',
      'hint',
    );
    expect(result).toBe('model not found');
  });
});
