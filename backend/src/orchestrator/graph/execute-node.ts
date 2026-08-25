import type { ChatMessage, LlmChatResult, ToolCall, ToolDefinition } from '../../llm/llm.types';
import { emitTurnStatus, OrchestratorEmitter } from '../orchestrator.events';
import {
  ExecuteActionRecord,
  ExecuteResult,
  GraphNodeResult,
  GraphState,
} from './graph-state.types';
import {
  denyMessage,
  filterToolDefinitionsForNode,
  isExecuteToolAllowed,
} from './graph-tool-allowlist.util';
import { runGraphMiniLoop } from './graph-mini-loop.util';

export interface ExecuteNodeContext {
  state: GraphState;
  emitter: OrchestratorEmitter;
  allTools: ToolDefinition[];
  chat: (messages: ChatMessage[], tools: ToolDefinition[]) => Promise<LlmChatResult>;
  executeToolCall: (call: ToolCall) => Promise<string>;
}

function normalizeExecute(raw: unknown, actions: ExecuteActionRecord[]): ExecuteResult | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const claimedDone = Boolean(o.claimedDone);
  const needsMoreResearch = Boolean(o.needsMoreResearch);
  const researchQuestions = Array.isArray(o.researchQuestions)
    ? o.researchQuestions.filter((q): q is string => typeof q === 'string')
    : [];
  const fromJson = Array.isArray(o.actions)
    ? o.actions
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a) => ({
          tool: String(a.tool ?? ''),
          action: String(a.action ?? ''),
          path: typeof a.path === 'string' ? a.path : undefined,
          ok: Boolean(a.ok),
          outputExcerpt: String(a.outputExcerpt ?? '').slice(0, 240),
        }))
    : [];
  return {
    actions: fromJson.length ? fromJson : actions,
    claimedDone,
    needsMoreResearch,
    researchQuestions,
  };
}

export async function runExecuteNode(ctx: ExecuteNodeContext): Promise<GraphNodeResult> {
  const state = ctx.state;
  emitTurnStatus(ctx.emitter, {
    stage: 'graph_execute',
    message: 'Execute node running…',
    percent: 55,
  });

  if (!state.research) {
    const reason = 'Execute node requires research findings.';
    state.nodeFailures.push({ node: 'execute', reason });
    return { ok: false, reason, state };
  }

  const allowedPaths = state.research.filePaths;
  const tools = filterToolDefinitionsForNode('execute', ctx.allTools);
  const recorded: ExecuteActionRecord[] = [];
  let forceNeedsResearch = false;
  let forceResearchQuestions: string[] = [];

  const systemPrompt = [
    'You are the EXECUTE node of a multi-agent graph.',
    'Act only on ResearchFindings — do not invent file paths or facts not listed there.',
    'Allowed tools: self_improve write|pull_request|run_checks|apply_preset|commit|inspect|status; remember_fact.',
    'If you need to inspect a path not in research.filePaths, set needsMoreResearch=true and list researchQuestions — do not invent.',
    'When you receive a FINAL ITERATION message, you MUST NOT call tools; reply with ONLY JSON:',
    '{"actions":[{"tool":string,"action":string,"path"?:string,"ok":boolean,"outputExcerpt":string}],"claimedDone":boolean,"needsMoreResearch"?:boolean,"researchQuestions"?:string[]}',
    'Set claimedDone=true only when mutation tools succeeded for the goal.',
  ].join(' ');

  const userPrompt = [
    `Goal: ${state.goal}`,
    `Research summary: ${state.research.summary}`,
    `Allowed filePaths: ${allowedPaths.join(', ') || '(none)'}`,
    `Facts: ${state.research.facts.join('; ') || '(none)'}`,
    `Evidence: ${state.research.evidenceSnippets.map((e) => `${e.source}:${e.excerpt}`).join(' | ').slice(0, 1200)}`,
  ].join('\n');

  const loop = await runGraphMiniLoop({
    systemPrompt,
    userPrompt,
    tools,
    deadlineAt: state.deadlineAt,
    chat: ctx.chat,
    runTool: async (call) => {
      const decision = isExecuteToolAllowed(call, allowedPaths);
      if (!decision.allowed) {
        const output = denyMessage(decision);
        state.toolRecords.push({
          toolName: call.name,
          action: String(call.arguments?.action ?? ''),
          output,
        });
        recorded.push({
          tool: call.name,
          action: String(call.arguments?.action ?? ''),
          path: typeof call.arguments?.path === 'string' ? call.arguments.path : undefined,
          ok: false,
          outputExcerpt: output.slice(0, 240),
        });
        if (decision.needsMoreResearch) {
          forceNeedsResearch = true;
          if (decision.researchPath) {
            forceResearchQuestions.push(`Inspect path ${decision.researchPath}`);
          }
          return {
            output,
            stopNode: false,
          };
        }
        return { output };
      }

      const output = await ctx.executeToolCall(call);
      state.toolRecords.push({
        toolName: call.name,
        action: String(call.arguments?.action ?? ''),
        output,
      });
      const ok = !/^Error:/i.test(output.trim());
      recorded.push({
        tool: call.name,
        action: String(call.arguments?.action ?? ''),
        path: typeof call.arguments?.path === 'string' ? call.arguments.path : undefined,
        ok,
        outputExcerpt: output.split('\n')[0]?.slice(0, 240) ?? '',
      });
      return { output };
    },
  });

  if (!loop.ok && !forceNeedsResearch) {
    state.nodeFailures.push({ node: 'execute', reason: loop.reason ?? 'Execute failed' });
    return { ok: false, reason: loop.reason, state };
  }

  let result = normalizeExecute(loop.parsed, recorded);
  if (!result) {
    if (forceNeedsResearch) {
      result = {
        actions: recorded,
        claimedDone: false,
        needsMoreResearch: true,
        researchQuestions: forceResearchQuestions,
      };
    } else {
      const reason = 'Execute node returned invalid JSON.';
      state.nodeFailures.push({ node: 'execute', reason });
      return { ok: false, reason, state };
    }
  }

  if (forceNeedsResearch) {
    result.needsMoreResearch = true;
    result.claimedDone = false;
    result.researchQuestions = [
      ...(result.researchQuestions ?? []),
      ...forceResearchQuestions,
    ];
  }

  state.execute = result;
  return { ok: true, state };
}
