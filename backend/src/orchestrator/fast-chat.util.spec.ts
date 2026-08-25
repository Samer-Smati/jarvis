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
  isBrainOpsMetaQuestion,
  isBrainOpsPauseRequest,
  isBrainOpsResumeRequest,
  isBrainGraphRequest,
  isBrainUiDenyRequest,
  isMetaComplaintForFiling,
  requiresWebSearch,
  extractWebSearchQuery,
  hasMeaningfulSearchQueryExtract,
  isAboutUserQuery,
  buildAboutUserReply,
  isUserProfileVaultHit,
  prefersStructuredMemoryOverBrain,
  isUrlIngestTurn,
  isWeatherRequest,
  extractWeatherLocation,
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
    expect(isMetaComplaintForFiling('I am concerned about node counts not matching')).toBe(true);
    expect(isBrainOpsDenyOrComplaint('I am concerned about node counts not matching')).toBe(false);
  });

  it('blocks graph fast path when user denies graph UI', () => {
    expect(isBrainGraphRequest('Do not show me the graph or change the subject')).toBe(false);
    expect(isBrainUiDenyRequest('Do not show me the graph or change the subject')).toBe(true);
  });

  it('routes deletion-log questions to meta path not pause', () => {
    expect(isBrainOpsMetaQuestion('does a deletion log exist for removed pages')).toBe(true);
    expect(isBrainOpsPauseRequest('does a deletion log exist for removed pages')).toBe(false);
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

describe('structured memory vs brain routing', () => {
  it('does not force URL ingest when user demands remember_fact instead of brain', () => {
    const text =
      'Store this with remember_fact — do NOT use brain/ingest_url. My name is Samer Smati. https://example.com/portfolio';
    expect(prefersStructuredMemoryOverBrain(text)).toBe(true);
    expect(isUrlIngestTurn(text)).toBe(false);
    expect(isSaveToBrainRequest(text)).toBe(false);
  });

  it('still treats bare portfolio URLs as ingest turns', () => {
    expect(isUrlIngestTurn('https://example.com/me')).toBe(true);
    expect(isUrlIngestTurn('Read this and save it https://example.com/me')).toBe(true);
  });
});

describe('about-user routing', () => {
  it('matches classic about-me prompts and correction follow-ups', () => {
    expect(isAboutUserQuery('What do you know about me?')).toBe(true);
    expect(isAboutUserQuery('tell me about myself')).toBe(true);
    expect(
      isAboutUserQuery(
        "That's not about me — that's a Hugging Face models page. I asked what you know about ME specifically: my name, role, preferences",
      ),
    ).toBe(true);
    expect(isAboutUserQuery('about me specifically — my name and role')).toBe(true);
  });

  it('does not treat unrelated questions as about-me', () => {
    expect(isAboutUserQuery('What do you know about Hugging Face models?')).toBe(false);
    expect(isAboutUserQuery('Open the brain graph')).toBe(false);
  });

  it('prioritizes the user profile entity over unrelated vault hits', () => {
    const text = buildAboutUserReply({
      userPage: {
        title: 'Samer Smati',
        content: '# Samer Smati\nFull-stack engineer and JARVIS owner. Prefers French.',
      },
      queryHits: [
        {
          title: 'Hugging Face Models',
          path: 'sources/huggingface-models.md',
          excerpt: 'Catalog of open LLM weights on the Hub.',
        },
      ],
      facts: ['Likes tea'],
    });
    expect(text).toContain('Samer Smati');
    expect(text).toContain('Full-stack engineer');
    expect(text).not.toContain('Hugging Face');
  });

  it('prioritizes stored preferences over turn-like memory hits', () => {
    const text = buildAboutUserReply({
      userPage: null,
      preferences: ['user.name: Samer Smati', 'user.role: full-stack developer'],
      facts: [
        'User: My name is Samer Smati\nJARVIS: Fact stored.',
        'user.region: GCC/MENA (Dubai)',
      ],
    });
    expect(text).toContain('user.name: Samer Smati');
    expect(text).toContain('user.role: full-stack developer');
    expect(text).not.toContain('JARVIS:');
    expect(text).not.toMatch(/^From memory/i);
  });

  it('ignores conversation-turn echoes when building from facts only', () => {
    const text = buildAboutUserReply({
      userPage: null,
      facts: [
        'User: What do you know about me?\nJARVIS: From memory, sir: User: My name is Samer',
      ],
    });
    expect(text).not.toContain('From memory, sir: User:');
    expect(text).toMatch(/don't have structured facts/i);
  });

  it('filters non-profile vault hits when no user entity page exists', () => {
    expect(
      isUserProfileVaultHit({
        title: 'Hugging Face Models',
        path: 'sources/huggingface-models.md',
        excerpt: 'Catalog of open LLM weights',
      }),
    ).toBe(false);
    expect(
      isUserProfileVaultHit({
        title: 'User Profile',
        path: 'entities/user-samer-smati.md',
        excerpt: 'Samer is the owner',
      }),
    ).toBe(true);

    const text = buildAboutUserReply({
      userPage: null,
      queryHits: [
        {
          title: 'Hugging Face Models',
          path: 'sources/huggingface-models.md',
          excerpt: 'Catalog of open LLM weights on the Hub.',
        },
      ],
      facts: [],
    });
    expect(text).toBeTruthy();
    expect(text).not.toContain('Hugging Face Models');
    expect(text).toMatch(/don't have a dedicated user profile|no dedicated user profile/i);
  });
});

describe('weather location extraction', () => {
  it('detects weather requests', () => {
    expect(isWeatherRequest("what's the weather in Tunis")).toBe(true);
    expect(isWeatherRequest('chnawa el ta9es fi tunis')).toBe(true);
    expect(isWeatherRequest('tell me a joke')).toBe(false);
  });

  it('stops the location at trailing filler words instead of swallowing them', () => {
    expect(extractWeatherLocation("what's the weather in Tunis right now?")).toBe('Tunis');
    expect(extractWeatherLocation('weather in Tunis today please')).toBe('Tunis');
  });

  it('does not swallow a second clause of a compound request', () => {
    expect(
      extractWeatherLocation(
        "What's the weather in Tunis right now, and also search the web for today's top tech news headline?",
      ),
    ).toBe('Tunis');
    expect(extractWeatherLocation('weather in Paris and also tell me a joke')).toBe('Paris');
  });

  it('extracts multi-word city names', () => {
    expect(extractWeatherLocation('weather in New York right now')).toBe('New York');
  });

  it('returns null when there is no location', () => {
    expect(extractWeatherLocation('what is the weather')).toBeNull();
  });

  it('flags a compound weather+search request as also requiring web search', () => {
    // orchestrator.service.ts guards the weather fast-path with `&& !requiresWebSearch(userText)`
    // so a message like this falls through to the normal tool-calling loop (which can call both
    // get_weather and web_search) instead of the fast path answering only the weather half.
    expect(
      requiresWebSearch(
        "What's the weather in Tunis right now, and also search the web for today's top tech news headline?",
      ),
    ).toBe(true);
  });
});
