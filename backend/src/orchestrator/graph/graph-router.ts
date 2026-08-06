import type { ChatMessage, LlmChatResult, ToolCall, ToolDefinition } from '../../llm/llm.types';
import { OrchestratorEmitter } from '../orchestrator.events';
import {
  buildGraphFailureReply,
  buildGraphSuccessReply,
  buildGraphTransitionPayload,
} from './graph-audit.util';
import { createInitialGraphState, GraphState } from './graph-state.types';
import { runExecuteNode } from './execute-node';
import { runResearchNode } from './research-node';
import { runVerifyNode } from './verify-node';

const MIN_NODE_BUDGET_MS = 20_000;

export interface GraphAuditFn {
  (action: string, trigger: string, detail: string, outcome: string): Promise<void> | void;
}

export interface GraphRunnerContext {
  goal: string;
  conversationId: string;
  trigger: string;
  deadlineAt: number;
  emitter: OrchestratorEmitter;
  allTools: ToolDefinition[];
  chat: (messages: ChatMessage[], tools: ToolDefinition[]) => Promise<LlmChatResult>;
  executeToolCall: (call: ToolCall) => Promise<string>;
  audit: GraphAuditFn;
}

function nodeBudgetMs(deadlineAt: number, remainingNodes: number): number {
  const remaining = Math.max(0, deadlineAt - Date.now());
  if (remainingNodes <= 0) {
    return remaining;
  }
  return Math.max(MIN_NODE_BUDGET_MS, Math.floor(remaining / remainingNodes));
}

function withNodeDeadline(state: GraphState, remainingNodes: number): GraphState {
  const budget = nodeBudgetMs(state.deadlineAt, remainingNodes);
  const nodeDeadline = Math.min(state.deadlineAt, Date.now() + budget);
  return { ...state, deadlineAt: nodeDeadline };
}

async function auditTransition(
  audit: GraphAuditFn,
  trigger: string,
  from: Parameters<typeof buildGraphTransitionPayload>[0],
  to: Parameters<typeof buildGraphTransitionPayload>[1],
  state: GraphState,
  outcome: 'success' | 'failure',
): Promise<void> {
  await audit('graph_transition', trigger, buildGraphTransitionPayload(from, to, state), outcome);
}

export async function runComplexGraphTask(ctx: GraphRunnerContext): Promise<string> {
  let state = createInitialGraphState({
    goal: ctx.goal,
    conversationId: ctx.conversationId,
    deadlineAt: ctx.deadlineAt,
  });

  await auditTransition(ctx.audit, ctx.trigger, 'start', 'research', state, 'success');

  const researchPass = async (extraQuestions?: string[]) => {
    if (Date.now() > ctx.deadlineAt) {
      return {
        ok: false as const,
        reason: 'Deadline exceeded before research.',
        state,
      };
    }
    const bounded = withNodeDeadline({ ...state, deadlineAt: ctx.deadlineAt }, state.loopBackUsed ? 2 : 3);
    const result = await runResearchNode({
      state: bounded,
      emitter: ctx.emitter,
      allTools: ctx.allTools,
      chat: ctx.chat,
      executeToolCall: ctx.executeToolCall,
      extraQuestions,
    });
    state = { ...result.state, deadlineAt: ctx.deadlineAt };
    return result;
  };

  let research = await researchPass();
  if (!research.ok) {
    await auditTransition(ctx.audit, ctx.trigger, 'research', 'failed', state, 'failure');
    return buildGraphFailureReply('research', research.reason ?? 'Research failed', state);
  }
  await auditTransition(ctx.audit, ctx.trigger, 'research', 'execute', state, 'success');

  const runExecute = async () => {
    if (Date.now() > ctx.deadlineAt) {
      return {
        ok: false as const,
        reason: 'Deadline exceeded before execute.',
        state,
      };
    }
    const bounded = withNodeDeadline({ ...state, deadlineAt: ctx.deadlineAt }, 2);
    const result = await runExecuteNode({
      state: bounded,
      emitter: ctx.emitter,
      allTools: ctx.allTools,
      chat: ctx.chat,
      executeToolCall: ctx.executeToolCall,
    });
    state = { ...result.state, deadlineAt: ctx.deadlineAt };
    return result;
  };

  let execute = await runExecute();
  if (!execute.ok) {
    await auditTransition(ctx.audit, ctx.trigger, 'execute', 'failed', state, 'failure');
    return buildGraphFailureReply('execute', execute.reason ?? 'Execute failed', state);
  }

  if (state.execute?.needsMoreResearch && !state.loopBackUsed) {
    state.loopBackUsed = true;
    const questions = state.execute.researchQuestions ?? state.research?.openQuestions ?? [];
    await auditTransition(ctx.audit, ctx.trigger, 'execute', 'research', state, 'success');
    research = await researchPass(questions);
    if (!research.ok) {
      await auditTransition(ctx.audit, ctx.trigger, 'research', 'failed', state, 'failure');
      return buildGraphFailureReply('research', research.reason ?? 'Research loop-back failed', state);
    }
    await auditTransition(ctx.audit, ctx.trigger, 'research', 'execute', state, 'success');
    execute = await runExecute();
    if (!execute.ok) {
      await auditTransition(ctx.audit, ctx.trigger, 'execute', 'failed', state, 'failure');
      return buildGraphFailureReply('execute', execute.reason ?? 'Execute failed after loop-back', state);
    }
  } else if (state.execute?.needsMoreResearch && state.loopBackUsed) {
    const reason = 'Execute still needs more research after the one allowed loop-back.';
    state.nodeFailures.push({ node: 'execute', reason });
    await auditTransition(ctx.audit, ctx.trigger, 'execute', 'failed', state, 'failure');
    return buildGraphFailureReply('execute', reason, state);
  }

  await auditTransition(ctx.audit, ctx.trigger, 'execute', 'verify', state, 'success');

  if (Date.now() > ctx.deadlineAt) {
    const reason = 'Deadline exceeded before verify.';
    return buildGraphFailureReply('verify', reason, state);
  }

  const verify = runVerifyNode({ state, emitter: ctx.emitter });
  state = verify.state;
  if (!verify.ok) {
    await auditTransition(ctx.audit, ctx.trigger, 'verify', 'failed', state, 'failure');
    return buildGraphFailureReply('verify', verify.reason ?? 'Verify failed', state);
  }

  await auditTransition(ctx.audit, ctx.trigger, 'verify', 'done', state, 'success');
  return buildGraphSuccessReply(state);
}
