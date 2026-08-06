import type { ChatMessage, LlmChatResult, ToolCall, ToolDefinition } from '../../llm/llm.types';
import { emitTurnStatus, OrchestratorEmitter } from '../orchestrator.events';
import { GraphNodeResult, GraphState, ResearchFindings } from './graph-state.types';
import { denyMessage, filterToolDefinitionsForNode, isResearchToolAllowed } from './graph-tool-allowlist.util';
import { runGraphMiniLoop } from './graph-mini-loop.util';

export interface ResearchNodeContext {
  state: GraphState;
  emitter: OrchestratorEmitter;
  allTools: ToolDefinition[];
  chat: (messages: ChatMessage[], tools: ToolDefinition[]) => Promise<LlmChatResult>;
  executeToolCall: (call: ToolCall) => Promise<string>;
  extraQuestions?: string[];
}

function normalizeFindings(raw: unknown, extraQuestions: string[]): ResearchFindings | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === 'string' ? o.summary : '';
  const filePaths = Array.isArray(o.filePaths)
    ? o.filePaths.filter((p): p is string => typeof p === 'string')
    : [];
  const facts = Array.isArray(o.facts) ? o.facts.filter((f): f is string => typeof f === 'string') : [];
  const evidenceSnippets = Array.isArray(o.evidenceSnippets)
    ? o.evidenceSnippets
        .filter((e): e is { source: string; excerpt: string } => {
          return !!e && typeof e === 'object' && typeof (e as { source?: unknown }).source === 'string';
        })
        .map((e) => ({
          source: e.source,
          excerpt: typeof e.excerpt === 'string' ? e.excerpt : '',
        }))
    : [];
  const openQuestions = Array.isArray(o.openQuestions)
    ? o.openQuestions.filter((q): q is string => typeof q === 'string')
    : [];
  for (const q of extraQuestions) {
    if (!openQuestions.includes(q)) {
      openQuestions.push(q);
    }
  }
  if (!summary.trim() && !filePaths.length && !facts.length && !evidenceSnippets.length) {
    return null;
  }
  return { summary, filePaths, facts, evidenceSnippets, openQuestions };
}

export async function runResearchNode(ctx: ResearchNodeContext): Promise<GraphNodeResult> {
  const state = ctx.state;
  emitTurnStatus(ctx.emitter, {
    stage: 'graph_research',
    message: 'Research node running…',
    percent: 20,
  });

  const tools = filterToolDefinitionsForNode('research', ctx.allTools);
  const extra = ctx.extraQuestions ?? state.research?.openQuestions ?? [];
  const prior = state.research
    ? `\nPrior findings summary: ${state.research.summary}\nKnown paths: ${state.research.filePaths.join(', ')}\nOpen questions: ${extra.join('; ')}`
    : extra.length
      ? `\nFocus questions: ${extra.join('; ')}`
      : '';

  const systemPrompt = [
    'You are the RESEARCH node of a multi-agent graph.',
    'Use only read-only tools: web_search; brain query|get_page|graph; self_improve inspect|status|verify_responsive.',
    'Do NOT write code, open PRs, remember_fact, or mutate brain.',
    'After gathering evidence, respond with ONLY a JSON object matching:',
    '{"summary":string,"filePaths":string[],"facts":string[],"evidenceSnippets":[{"source":string,"excerpt":string}],"openQuestions":string[]}',
    'filePaths must only include paths you actually inspected or saw in tool output.',
  ].join(' ');

  const loop = await runGraphMiniLoop({
    systemPrompt,
    userPrompt: `Goal: ${state.goal}${prior}`,
    tools,
    deadlineAt: state.deadlineAt,
    chat: ctx.chat,
    runTool: async (call) => {
      const decision = isResearchToolAllowed(call);
      if (!decision.allowed) {
        const output = denyMessage(decision);
        state.toolRecords.push({
          toolName: call.name,
          action: String(call.arguments?.action ?? ''),
          output,
        });
        return { output };
      }
      const output = await ctx.executeToolCall(call);
      state.toolRecords.push({
        toolName: call.name,
        action: String(call.arguments?.action ?? ''),
        output,
      });
      return { output };
    },
  });

  if (!loop.ok) {
    state.nodeFailures.push({ node: 'research', reason: loop.reason ?? 'Research failed' });
    return { ok: false, reason: loop.reason, state };
  }

  const findings = normalizeFindings(loop.parsed, extra);
  if (!findings) {
    const reason = 'Research node returned JSON without usable findings.';
    state.nodeFailures.push({ node: 'research', reason });
    return { ok: false, reason, state };
  }

  state.research = findings;
  return { ok: true, state };
}
