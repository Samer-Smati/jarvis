import {
  containsRawToolCallMarkup,
  parseTextToolCallsFromContent,
  sanitizeUserFacingAssistantText,
  stripRawToolCallMarkup,
  ToolMarkupStreamFilter,
} from './text-tool-call.util';

describe('text-tool-call.util', () => {
  it('parses arg_key/arg_value tool_call blocks into structured calls', () => {
    const raw =
      '<tool_call>web_search <arg_key>query</arg_key> <arg_value>best LLM rankings</arg_value> </tool_call>';
    const parsed = parseTextToolCallsFromContent(raw);
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0]?.name).toBe('web_search');
    expect(parsed.toolCalls[0]?.arguments?.query).toBe('best LLM rankings');
    expect(parsed.content).not.toContain('<tool_call>');
  });

  it('strips raw tool markup from user-facing text', () => {
    const raw =
      'Here you go <tool_call>web_search <arg_key>query</arg_key> <arg_value>test</arg_value> </tool_call>';
    expect(stripRawToolCallMarkup(raw)).not.toMatch(/<tool_call>|arg_key|arg_value/i);
  });

  it('returns a clean fallback when only tool markup remains', () => {
    const fallback = sanitizeUserFacingAssistantText(
      '<tool_call>web_search <arg_key>query</arg_key> <arg_value>x</arg_value> </tool_call>',
    );
    expect(fallback).not.toContain('<tool_call>');
    expect(fallback.toLowerCase()).toContain('search');
  });

  it('never emits raw tool-call syntax through the stream filter', () => {
    const filter = new ToolMarkupStreamFilter();
    let emitted = '';
    filter.feed('<tool_call>web_search <arg_key>query</arg_key> <arg_value>test</arg_value> </tool_call>', (safe) => {
      emitted += safe;
    });
    expect(emitted).not.toContain('<tool_call>');
    expect(containsRawToolCallMarkup(emitted)).toBe(false);
  });
});
