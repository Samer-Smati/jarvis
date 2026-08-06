import {
  classifyGraphTask,
  isComplexGraphTask,
} from './graph-classifier.util';

describe('graph-classifier.util', () => {
  it('routes debug and open a PR to graph', () => {
    const text = 'Debug the about-me recall bug in Jarvis and open a PR with the fix';
    const result = classifyGraphTask(text);
    expect(result.route).toBe('graph');
    expect(result.researchHit).toBe(true);
    expect(result.mutationHit).toBe(true);
    expect(isComplexGraphTask(text)).toBe(true);
  });

  it('routes investigate and fix to graph', () => {
    expect(
      isComplexGraphTask('Investigate the memory filter and fix the root cause in the repo'),
    ).toBe(true);
  });

  it('keeps plan-only / architecture on flat', () => {
    const result = classifyGraphTask(
      'Inspect the orchestrator and explain the architecture plan only — do not write or open a PR',
    );
    expect(result.route).toBe('flat');
    expect(result.reason).toBe('plan_only_or_architecture');
  });

  it('keeps simple weather / greetings on flat', () => {
    expect(isComplexGraphTask('What is the weather in Paris?')).toBe(false);
    expect(isComplexGraphTask('Hello Jarvis')).toBe(false);
  });

  it('keeps mutation-only without research signal on flat with partial flag', () => {
    const result = classifyGraphTask('Open a PR to update personality.ts in the jarvis repo');
    expect(result.route).toBe('flat');
    expect(result.partialComplexSignals).toBe(true);
    expect(result.mutationHit).toBe(true);
  });

  it('keeps research-only without mutation on flat with partial flag', () => {
    const result = classifyGraphTask('Investigate why the brain graph is slow in the jarvis repo');
    expect(result.route).toBe('flat');
    expect(result.partialComplexSignals).toBe(true);
    expect(result.researchHit).toBe(true);
  });

  it('routes find and fix to graph when code context present', () => {
    expect(isComplexGraphTask('Find and fix the bug in backend memory service')).toBe(true);
  });
});
