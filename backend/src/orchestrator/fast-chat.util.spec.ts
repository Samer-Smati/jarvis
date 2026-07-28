import {
  isExplicitLessonRequest,
  extractExplicitLessonText,
  isSaveToBrainRequest,
  isExplicitWebSearchRequest,
  isCurrentStateQuestion,
  requiresWebSearch,
  extractWebSearchQuery,
} from './fast-chat.util';

describe('web search intent', () => {
  it('detects explicit search-before-answer instructions', () => {
    expect(isExplicitWebSearchRequest('search the web to verify before answering')).toBe(true);
    expect(isExplicitWebSearchRequest('Please verify this online before you reply')).toBe(true);
    expect(isExplicitWebSearchRequest('look this up on the web')).toBe(true);
  });

  it('detects current-state ranking and availability questions', () => {
    expect(isCurrentStateQuestion('What are the best LLM rankings in 2026?')).toBe(true);
    expect(isCurrentStateQuestion('Is Claude currently available in the EU?')).toBe(true);
    expect(isCurrentStateQuestion('How much does ChatGPT Plus cost today?')).toBe(true);
  });

  it('does not flag timeless trivia as search-required', () => {
    expect(isCurrentStateQuestion('Who invented the telephone?')).toBe(false);
    expect(requiresWebSearch('Explain how HTTP works')).toBe(false);
  });

  it('extracts a focused search query from instruction-heavy prompts', () => {
    const q = extractWebSearchQuery('search the web to verify: best coding models in 2026');
    expect(q.toLowerCase()).toContain('best coding models');
  });
});

describe('fast-chat explicit lessons', () => {
  it('detects correction-style remember phrases', () => {
    expect(
      isExplicitLessonRequest("Remember that when I ask for 'the report' I mean the weekly sales report"),
    ).toBe(true);
  });

  it('rejects generic remember-fact phrases', () => {
    expect(isExplicitLessonRequest('Remember that I like tea')).toBe(false);
  });

  it('routes generic remember to brain save, not explicit lesson', () => {
    expect(isSaveToBrainRequest('Remember that I like tea')).toBe(true);
    expect(isSaveToBrainRequest("Remember that when I say report I mean weekly sales")).toBe(false);
  });

  it('extracts imperative lesson text', () => {
    const text = extractExplicitLessonText(
      "Remember that when I ask for 'the report' I mean the weekly sales report",
    );
    expect(text).toContain('weekly sales report');
    expect(text?.length).toBeLessThanOrEqual(220);
  });
});
