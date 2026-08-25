import {
  applyCompletionClaimGuard,
  hasRememberFactEvidence,
  hasWriteEvidence,
} from './completion-claim-guard.util';
import { GraphState } from './graph-state.types';

function baseState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    goal: 'Debug the bug and open a PR',
    conversationId: 'c1',
    startedAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
    loopBackUsed: false,
    toolRecords: [],
    nodeFailures: [],
    execute: {
      actions: [{ tool: 'self_improve', action: 'pull_request', ok: true, outputExcerpt: 'ok' }],
      claimedDone: true,
    },
    ...overrides,
  };
}

describe('completion-claim-guard.util', () => {
  it('fails when claimedDone without PR/write evidence', () => {
    const result = applyCompletionClaimGuard({
      state: baseState({
        toolRecords: [{ toolName: 'self_improve', action: 'inspect', output: 'Listed files' }],
      }),
    });
    expect(result.passed).toBe(false);
    expect(result.failureReason).toMatch(/Missing Pull request|no successful/i);
  });

  it('passes when real PR evidence is present', () => {
    const toolRecords = [
      {
        toolName: 'self_improve',
        action: 'write',
        output: 'Wrote backend/src/foo.ts locally (120 bytes). Run run_checks then commit or pull_request.',
      },
      {
        toolName: 'self_improve',
        action: 'pull_request',
        output: 'Pull request #9 opened: https://github.com/Samer-Smati/jarvis/pull/9',
      },
    ];
    const result = applyCompletionClaimGuard({
      state: baseState({
        toolRecords,
        execute: {
          actions: [
            { tool: 'self_improve', action: 'write', ok: true, outputExcerpt: 'Wrote' },
            { tool: 'self_improve', action: 'pull_request', ok: true, outputExcerpt: 'PR' },
          ],
          claimedDone: true,
        },
      }),
    });
    expect(result.passed).toBe(true);
    expect(hasWriteEvidence(toolRecords)).toBe(true);
  });

  it('detects write evidence helper', () => {
    expect(
      hasWriteEvidence([
        {
          toolName: 'self_improve',
          action: 'write',
          output: 'Wrote backend/src/orchestrator/personality.ts locally (400 bytes).',
        },
      ]),
    ).toBe(true);
  });

  it('checks remember_fact IDs when memory claimed', () => {
    const output =
      'Stored 1 user_preferences row(s): user.name=Samer (pref-abc-12345678)\nBrain vault was not updated.';
    expect(hasRememberFactEvidence([{ toolName: 'remember_fact', action: '', output }])).toBe(true);

    const fail = applyCompletionClaimGuard({
      state: baseState({
        goal: 'Investigate prefs and remember the fact',
        execute: {
          actions: [{ tool: 'remember_fact', action: '', ok: true, outputExcerpt: 'ok' }],
          claimedDone: true,
        },
        toolRecords: [{ toolName: 'remember_fact', action: '', output: 'Error: nothing was stored.' }],
      }),
    });
    expect(fail.passed).toBe(false);
    expect(fail.failureReason).toMatch(/remember_fact/i);

    const pass = applyCompletionClaimGuard({
      state: baseState({
        goal: 'Investigate prefs and remember the fact',
        execute: {
          actions: [{ tool: 'remember_fact', action: '', ok: true, outputExcerpt: 'ok' }],
          claimedDone: true,
        },
        toolRecords: [{ toolName: 'remember_fact', action: '', output }],
      }),
    });
    expect(pass.passed).toBe(true);
  });
});
