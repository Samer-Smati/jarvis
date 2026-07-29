import {
  isExplicitLessonRequest,
  extractExplicitLessonText,
  isSaveToBrainRequest,
  isExplicitWebSearchRequest,
  isCurrentStateQuestion,
  isWebSearchMetaQuestion,
  isCodeArchitectureQuestion,
  isPlanOnlyRequest,
  isBrainPlanOnlyRequest,
  isBrainCleanupRequest,
  isBrainConsolidateRequest,
  isBrainOpsDenyOrComplaint,
  isBrainOpsPauseRequest,
  isBrainOpsResumeRequest,
  requiresWebSearch,
  extractWebSearchQuery,
  hasMeaningfulSearchQueryExtract,
} from './fast-chat.util';

const META_SENTENCE =
  'Confirm: did that answer come from a live web search, or from your training data? Be direct.';

describe('web search intent', () => {
  it('detects explicit search-before-answer instructions', () => {
    expect(isExplicitWebSearchRequest('search the web to verify before answering')).toBe(true);
    expect(isExplicitWebSearchRequest('Please verify this online before you reply')).toBe(true);
    expect(isExplicitWebSearchRequest('look this up on the web')).toBe(true);
  });

  it('does not treat meta questions about prior search behavior as search requests', () => {
    expect(isWebSearchMetaQuestion(META_SENTENCE)).toBe(true);
    expect(isExplicitWebSearchRequest(META_SENTENCE)).toBe(false);
    expect(requiresWebSearch(META_SENTENCE)).toBe(false);
    expect(hasMeaningfulSearchQueryExtract(META_SENTENCE)).toBe(false);
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

  it('strips leftover before answering fragments from search queries', () => {
    const now = new Date('2026-07-28T12:00:00Z');
    const q = extractWebSearchQuery(
      'search the web to verify before answering: what are the best LLM models?',
      now,
    );
    expect(q.toLowerCase()).not.toContain('before answering');
    expect(q).toContain('2026');
  });

  it('uses the actual system clock year for recency queries without an explicit year', () => {
    const now = new Date('2026-07-28T12:00:00Z');
    const q = extractWebSearchQuery('What are the best LLM rankings right now?', now);
    expect(q).toContain('2026');
    expect(q).not.toMatch(/\b2024\b|\b2025\b/);
  });
});

describe('code architecture questions', () => {
  it('detects pre-merge scheduler and inspect challenges', () => {
    expect(
      isCodeArchitectureQuestion(
        'Before I merge PR #3: walk me through exactly how the daily schedule triggers this skill.',
      ),
    ).toBe(true);
    expect(
      isCodeArchitectureQuestion(
        'That description is false. I have the actual code — do not describe capabilities not in the code.',
      ),
    ).toBe(true);
  });

  it('detects plan-only audit prompts', () => {
    expect(isPlanOnlyRequest('Revise the file list only. Still no write, no PR.')).toBe(true);
    expect(isPlanOnlyRequest('Proceed with inspect → write → pull_request')).toBe(false);
  });

  it('detects brain cleanup plan without executing fast paths', () => {
    expect(isBrainPlanOnlyRequest('Give me a brain-cleanup plan')).toBe(true);
    expect(isBrainCleanupRequest('Give me a brain-cleanup plan')).toBe(false);
    expect(isBrainPlanOnlyRequest('Run brain cleanup now')).toBe(false);
    expect(isBrainConsolidateRequest('link all brain pages now')).toBe(true);
    expect(isBrainPlanOnlyRequest('Plan for linking brain pages before you run consolidate')).toBe(true);
  });

  it('does not treat halt or complaint messages as cleanup/consolidate requests', () => {
    expect(
      isBrainOpsDenyOrComplaint(
        'do not run any more cleanup/consolidate on the brain until I review the graph',
      ),
    ).toBe(true);
    expect(
      isBrainCleanupRequest(
        'do not run any more cleanup/consolidate on the brain until I review the graph',
      ),
    ).toBe(false);
    expect(
      isBrainConsolidateRequest(
        'do not run any more cleanup/consolidate on the brain until I review the graph',
      ),
    ).toBe(false);
    expect(isBrainConsolidateRequest("why aren't brain pages linked")).toBe(false);
    expect(isBrainConsolidateRequest("nodes aren't linked in the graph")).toBe(false);
    expect(isBrainConsolidateRequest('consolidate brain links now')).toBe(true);
    expect(isBrainOpsDenyOrComplaint('I am concerned about node counts not matching')).toBe(true);
  });

  it('detects pause and resume brain ops commands', () => {
    expect(isBrainOpsPauseRequest('stop running cleanup on the brain until I review')).toBe(true);
    expect(isBrainOpsResumeRequest('resume brain operations')).toBe(true);
    expect(isBrainOpsPauseRequest('resume brain operations')).toBe(false);
  });

  it('does not treat web-search meta questions as code architecture', () => {
    expect(isCodeArchitectureQuestion(META_SENTENCE)).toBe(false);
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
