import {
  applyPrClaimGuard,
  hasPullRequestEvidence,
  onlyBrainIngestWithoutCodeWork,
  responseAssertsPrOrCodeCompletion,
  userRequestedPullRequestOrCodeWork,
} from './pr-claim-guard.util';

describe('pr-claim-guard.util', () => {
  it('detects pull request evidence in tool output', () => {
    expect(hasPullRequestEvidence(['Pull request #4 opened: https://github.com/x/y/pull/4'])).toBe(true);
    expect(hasPullRequestEvidence(['Updated file on branch jarvis/foo'])).toBe(false);
  });

  it('detects user PR/code work requests', () => {
    expect(
      userRequestedPullRequestOrCodeWork(
        'Please create the PR now: add verification-before-completion to the system prompt',
      ),
    ).toBe(true);
    expect(userRequestedPullRequestOrCodeWork('What is the weather in Paris?')).toBe(false);
  });

  it('blocks prose PR claim without tool evidence', () => {
    const result = applyPrClaimGuard({
      userText: 'Open the PR and give me the GitHub URL',
      candidate:
        'I inspected the repo, wrote the edits, and opened a pull request named "Add verification-before-completion integration."',
      toolRecords: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('prose_pr_claim');
    expect(result.shouldRetryWithTools).toBe(true);
    expect(result.text).toContain('cannot report that work as complete');
  });

  it('allows response when tool output has Pull request #N', () => {
    const result = applyPrClaimGuard({
      userText: 'Open the PR now',
      candidate: 'Done, sir. Pull request #5 opened for your review.',
      toolRecords: [
        {
          toolName: 'self_improve',
          action: 'pull_request',
          output: 'Pull request #5 opened: https://github.com/Samer-Smati/jarvis/pull/5',
        },
      ],
    });
    expect(result.blocked).toBe(false);
  });

  it('blocks brain ingest conflation with implementation claims', () => {
    expect(
      onlyBrainIngestWithoutCodeWork([
        { toolName: 'brain', action: 'ingest_url', output: 'Source saved.' },
        { toolName: 'self_improve', action: 'inspect', output: 'Listed backend/src' },
      ]),
    ).toBe(true);

    const result = applyPrClaimGuard({
      userText: 'Integrate verification-before-completion into the system prompt via PR',
      candidate:
        "I've successfully integrated the practice. The system prompt is updated and ready for your review.",
      toolRecords: [
        { toolName: 'brain', action: 'ingest_url', output: 'Source saved at brain/sources/...' },
        { toolName: 'self_improve', action: 'inspect', output: 'Listed backend/src/orchestrator/' },
      ],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('brain_ingest_conflation');
    expect(result.text).toContain('brain vault');
  });

  it('detects completion language in responses', () => {
    expect(responseAssertsPrOrCodeCompletion('Successfully integrated the practice, sir.', true)).toBe(true);
    expect(responseAssertsPrOrCodeCompletion('The forecast for Paris is sunny.', false)).toBe(false);
  });
});
