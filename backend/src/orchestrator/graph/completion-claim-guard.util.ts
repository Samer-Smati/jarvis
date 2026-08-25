import {
  applyPrClaimGuard,
  hasPullRequestEvidence,
  ToolTurnRecord,
} from '../pr-claim-guard.util';
import { ExecuteResult, GraphState } from './graph-state.types';

export interface CompletionCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface CompletionClaimGuardResult {
  passed: boolean;
  checks: CompletionCheck[];
  failureReason?: string;
}

const WRITE_SUCCESS = /Wrote .+\s+(locally|on branch)/i;
const REMEMBER_FACT_STORED = /Stored \d+ (user_preferences|semantic_memories) row\(s\):/i;
const REMEMBER_FACT_ID_TOKEN = /\([A-Za-z0-9_-]{8,}\)/;

export function hasWriteEvidence(toolRecords: ToolTurnRecord[]): boolean {
  return toolRecords.some(
    (r) =>
      r.toolName === 'self_improve' &&
      r.action === 'write' &&
      WRITE_SUCCESS.test(r.output) &&
      !/^Error:/i.test(r.output.trim()),
  );
}

export function hasRememberFactEvidence(toolRecords: ToolTurnRecord[]): boolean {
  return toolRecords.some((r) => {
    if (r.toolName !== 'remember_fact' || /^Error:/i.test(r.output.trim())) {
      return false;
    }
    return REMEMBER_FACT_STORED.test(r.output) && REMEMBER_FACT_ID_TOKEN.test(r.output);
  });
}

export function executeClaimedCodeChange(execute?: ExecuteResult): boolean {
  if (!execute?.claimedDone) {
    return false;
  }
  return (execute.actions ?? []).some(
    (a) =>
      a.tool === 'self_improve' &&
      (a.action === 'write' || a.action === 'pull_request' || a.action === 'commit' || a.action === 'apply_preset'),
  );
}

export function executeClaimedMemory(execute?: ExecuteResult): boolean {
  if (!execute?.claimedDone) {
    return false;
  }
  return (execute.actions ?? []).some((a) => a.tool === 'remember_fact');
}

export function executeClaimedPullRequest(execute?: ExecuteResult, goal = ''): boolean {
  if (!execute?.claimedDone) {
    return false;
  }
  const actionPr = (execute.actions ?? []).some(
    (a) => a.tool === 'self_improve' && a.action === 'pull_request',
  );
  const goalPr = /\b(open\s+(a\s+)?pr|pull\s*request)\b/i.test(goal);
  return actionPr || goalPr;
}

/**
 * Deterministic VERIFY gate: extends PR-claim patterns with write + remember_fact evidence.
 */
export function applyCompletionClaimGuard(input: {
  state: Pick<GraphState, 'goal' | 'execute' | 'toolRecords'>;
}): CompletionClaimGuardResult {
  const { goal, execute, toolRecords } = input.state;
  const checks: CompletionCheck[] = [];

  if (!execute?.claimedDone) {
    checks.push({
      name: 'claimed_done',
      passed: false,
      detail: 'Execute did not claim completion (claimedDone=false).',
    });
    return {
      passed: false,
      checks,
      failureReason: 'Execute did not claim the work as done, so verify cannot pass.',
    };
  }

  checks.push({
    name: 'claimed_done',
    passed: true,
    detail: 'Execute claimedDone=true.',
  });

  const wantsPr = executeClaimedPullRequest(execute, goal);
  const wantsWrite = executeClaimedCodeChange(execute);
  const wantsMemory = executeClaimedMemory(execute);

  if (wantsPr) {
    const prOk = hasPullRequestEvidence(toolRecords.map((r) => r.output));
    checks.push({
      name: 'pull_request_evidence',
      passed: prOk,
      detail: prOk
        ? 'Tool output contains Pull request #N or github pull URL.'
        : 'Missing Pull request #N / github pull URL in tool outputs.',
    });
  }

  if (wantsWrite) {
    const writeOk = hasWriteEvidence(toolRecords) || hasPullRequestEvidence(toolRecords.map((r) => r.output));
    checks.push({
      name: 'write_evidence',
      passed: writeOk,
      detail: writeOk
        ? 'Write or PR tool evidence present.'
        : 'Code change claimed but no successful self_improve(write) / PR evidence.',
    });
  }

  if (wantsMemory) {
    const memOk = hasRememberFactEvidence(toolRecords);
    checks.push({
      name: 'remember_fact_evidence',
      passed: memOk,
      detail: memOk
        ? 'remember_fact output includes real stored IDs.'
        : 'Memory claimed but remember_fact output lacks stored row IDs.',
    });
  }

  if (!wantsPr && !wantsWrite && !wantsMemory) {
    const anyOkAction = (execute.actions ?? []).some((a) => a.ok);
    checks.push({
      name: 'any_successful_action',
      passed: anyOkAction,
      detail: anyOkAction
        ? 'At least one execute action succeeded.'
        : 'claimedDone without successful execute actions.',
    });
  }

  const proseGuard = applyPrClaimGuard({
    userText: goal,
    candidate: 'Done, sir. Successfully integrated the changes and opened a pull request.',
    toolRecords,
  });
  if (wantsPr || wantsWrite) {
    const proseOk = !proseGuard.blocked;
    checks.push({
      name: 'pr_claim_guard',
      passed: proseOk,
      detail: proseOk
        ? 'PR-claim guard would allow a completion reply.'
        : `PR-claim guard blocked: ${proseGuard.reason ?? 'unknown'}.`,
    });
  }

  const failed = checks.filter((c) => !c.passed);
  if (failed.length) {
    return {
      passed: false,
      checks,
      failureReason: failed.map((c) => c.detail).join(' '),
    };
  }

  return { passed: true, checks };
}
