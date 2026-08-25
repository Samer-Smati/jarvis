import { emitTurnStatus, OrchestratorEmitter } from '../orchestrator.events';
import { applyCompletionClaimGuard } from './completion-claim-guard.util';
import { GraphNodeResult, GraphState } from './graph-state.types';

export interface VerifyNodeContext {
  state: GraphState;
  emitter: OrchestratorEmitter;
}

export function runVerifyNode(ctx: VerifyNodeContext): GraphNodeResult {
  const state = ctx.state;
  emitTurnStatus(ctx.emitter, {
    stage: 'graph_verify',
    message: 'Verify node running…',
    percent: 85,
  });

  if (!state.execute) {
    const reason = 'Verify node requires execute results.';
    state.nodeFailures.push({ node: 'verify', reason });
    state.verify = { passed: false, checks: [], failureReason: reason };
    return { ok: false, reason, state };
  }

  const guard = applyCompletionClaimGuard({ state });
  state.verify = {
    passed: guard.passed,
    checks: guard.checks,
    failureReason: guard.failureReason,
  };

  if (!guard.passed) {
    const reason = guard.failureReason ?? 'Completion claims failed verification.';
    state.nodeFailures.push({ node: 'verify', reason });
    return { ok: false, reason, state };
  }

  return { ok: true, state };
}
