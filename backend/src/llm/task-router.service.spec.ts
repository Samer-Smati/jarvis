import { TaskRouterService } from './task-router.service';
import {
  isTierGranted,
  maxSkillTier,
  tierDenialMessage,
  TIER_ORDER,
} from '../skills/permissions';
import { validateSandboxPath } from '../skills/impl/sandbox.skill';

describe('TaskRouterService budget and context caps', () => {
  let router: TaskRouterService;

  beforeEach(() => {
    router = new TaskRouterService();
  });

  it('downgrades to quick_qa when daily budget exceeded with user notice', () => {
    router.setBudgetState(600_000);
    const route = router.resolve('refactor orchestrator.service.ts', undefined, 500);

    expect(route.requestedTask).toBe('coding');
    expect(route.task).toBe('quick_qa');
    expect(route.budgetDowngraded).toBe(true);
    expect(route.userNotice).toMatch(/budget/i);
    expect(route.reason).toMatch(/budget cap fallback/i);
  });

  it('downgrades quick_qa when context exceeds maxInputChars', () => {
    const route = router.resolve('hello', undefined, 50_000);

    expect(route.requestedTask).toBe('quick_qa');
    expect(route.contextDowngraded).toBe(true);
    expect(route.task).toBe('reasoning');
    expect(route.userNotice).toMatch(/large conversation history/i);
  });

  it('classifies explicit web search as tool_heavy', () => {
    const route = router.resolve('search the web to verify before answering', undefined, 500);
    expect(route.requestedTask).toBe('tool_heavy');
  });

  it('classifies current-state ranking questions as tool_heavy', () => {
    const route = router.resolve('What are the best LLM rankings in 2026?', undefined, 500);
    expect(route.requestedTask).toBe('tool_heavy');
  });

  it('does not classify web-search meta questions as tool_heavy', () => {
    const route = router.resolve(
      'Confirm: did that answer come from a live web search, or from your training data? Be direct.',
      undefined,
      500,
    );
    expect(route.requestedTask).not.toBe('tool_heavy');
  });
});

describe('Skill permission tiers', () => {
  const original = process.env.JARVIS_MAX_SKILL_TIER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.JARVIS_MAX_SKILL_TIER;
    } else {
      process.env.JARVIS_MAX_SKILL_TIER = original;
    }
  });

  it('blocks network skills when max tier is read', () => {
    process.env.JARVIS_MAX_SKILL_TIER = 'read';
    expect(isTierGranted('network', maxSkillTier())).toBe(false);
    expect(tierDenialMessage('web_search', 'network', 'read')).toMatch(/Permission denied/);
  });

  it('blocks write skills when max tier is read', () => {
    process.env.JARVIS_MAX_SKILL_TIER = 'read';
    expect(isTierGranted('write', maxSkillTier())).toBe(false);
  });

  it('allows sandbox when max tier is sandbox', () => {
    process.env.JARVIS_MAX_SKILL_TIER = 'sandbox';
    expect(isTierGranted('sandbox', maxSkillTier())).toBe(true);
  });

  it('orders tiers correctly', () => {
    expect(TIER_ORDER.indexOf('write')).toBeGreaterThan(TIER_ORDER.indexOf('read'));
    expect(TIER_ORDER.indexOf('network')).toBeGreaterThan(TIER_ORDER.indexOf('write'));
  });
});

describe('Sandbox path validation', () => {
  it('rejects path traversal in cwd', () => {
    const result = validateSandboxPath('../../etc', []);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Permission denied/);
  });

  it('rejects traversal in args', () => {
    const result = validateSandboxPath('.', ['../../etc/passwd']);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/path traversal/i);
  });

  it('accepts relative cwd under sandbox', () => {
    const result = validateSandboxPath('subdir', ['--version']);
    expect(result.ok).toBe(true);
    expect(result.resolvedCwd).toBeDefined();
  });
});
