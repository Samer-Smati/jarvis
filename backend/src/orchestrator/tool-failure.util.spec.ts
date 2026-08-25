import {
  buildSuccessfulToolReply,
  buildToolFailureReply,
  EMPTY_TURN_FALLBACK,
  isToolFailureOutput,
} from './tool-failure.util';

describe('tool-failure.util', () => {
  it('detects unknown action failures', () => {
    expect(isToolFailureOutput('Unknown action "".')).toBe(true);
  });

  it('builds user-visible failure reply', () => {
    const text = buildToolFailureReply([
      { toolName: 'self_improve', output: 'Unknown action "".' },
    ]);
    expect(text).toContain('self improve failed');
    expect(text).toContain('Unknown action');
  });

  it('synthesizes a real reply from successful tool output when finalText would be empty', () => {
    const text = buildSuccessfulToolReply(
      [
        {
          toolName: 'brain',
          action: 'query',
          output:
            'Hot cache:\n\nMatching pages:\n- User Profile (entities/user-samer.md, score 12)\n  Samer is a full-stack engineer.',
        },
      ],
      'Hot cache:\n\nMatching pages:\n- User Profile (entities/user-samer.md, score 12)\n  Samer is a full-stack engineer.',
    );
    expect(text).toBeTruthy();
    expect(text).toContain('User Profile');
    expect(text).toContain('full-stack engineer');
    expect(text).not.toMatch(/without a visible reply/i);
  });

  it('returns null when there is no usable successful tool output', () => {
    expect(buildSuccessfulToolReply([], '')).toBeNull();
    expect(
      buildSuccessfulToolReply(
        [{ toolName: 'brain', action: 'query', output: 'Error: vault unavailable' }],
        'Error: vault unavailable',
      ),
    ).toBeNull();
  });

  it('exports a spoken empty-turn fallback as last resort only', () => {
    expect(EMPTY_TURN_FALLBACK).toMatch(/say that once more/i);
  });
});
