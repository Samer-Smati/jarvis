import {
  isExplicitLessonRequest,
  extractExplicitLessonText,
  isSaveToBrainRequest,
} from './fast-chat.util';

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
