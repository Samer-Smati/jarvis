import { buildToolFailureReply, isToolFailureOutput } from './tool-failure.util';

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
});
