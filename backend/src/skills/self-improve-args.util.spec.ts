import { normalizeSelfImproveArgs } from './self-improve-args.util';

describe('normalizeSelfImproveArgs', () => {
  it('infers pull_request when branch or title present without action', () => {
    expect(normalizeSelfImproveArgs({ branch: 'jarvis/foo', title: 'System prompt' }).action).toBe(
      'pull_request',
    );
  });

  it('infers write when path and content present', () => {
    expect(normalizeSelfImproveArgs({ path: 'a.ts', content: 'x' }).action).toBe('write');
  });

  it('preserves explicit action', () => {
    expect(normalizeSelfImproveArgs({ action: 'inspect', path: 'a.ts' }).action).toBe('inspect');
  });
});
