import { GraphNodeId, GraphState } from './graph-state.types';
import { summarizeToolRecords } from '../pr-claim-guard.util';

export interface GraphTransitionSnapshot {
  from: GraphNodeId | 'start' | 'done';
  to: GraphNodeId | 'done' | 'failed';
  goal: string;
  filePaths?: string[];
  actionTools?: string[];
  verifyPassed?: boolean;
  loopBackUsed?: boolean;
}

export function buildGraphTransitionPayload(
  from: GraphTransitionSnapshot['from'],
  to: GraphTransitionSnapshot['to'],
  state: GraphState,
): string {
  const snapshot: GraphTransitionSnapshot = {
    from,
    to,
    goal: state.goal.slice(0, 200),
    filePaths: state.research?.filePaths?.slice(0, 20),
    actionTools: state.execute?.actions?.map((a) => `${a.tool}:${a.action}`).slice(0, 20),
    verifyPassed: state.verify?.passed,
    loopBackUsed: state.loopBackUsed,
  };
  return JSON.stringify({ from, to, stateSnapshot: snapshot });
}

export function buildGraphFailureReply(
  node: GraphNodeId,
  reason: string,
  state: GraphState,
): string {
  const tools = summarizeToolRecords(state.toolRecords);
  return [
    `Graph stopped at the ${node} node, sir — ${reason}.`,
    `Goal: ${state.goal.slice(0, 240)}`,
    `Last tools: ${tools}`,
  ].join('\n');
}

export function buildGraphSuccessReply(state: GraphState): string {
  const lines: string[] = [];
  const summary = state.research?.summary?.trim();
  if (summary) {
    lines.push(summary.slice(0, 400));
  }

  const actions = state.execute?.actions ?? [];
  if (actions.length) {
    const okActions = actions.filter((a) => a.ok).map((a) => `${a.tool}(${a.action})`);
    if (okActions.length) {
      lines.push(`Actions: ${okActions.join(', ')}.`);
    }
  }

  const evidenceLine = state.toolRecords
    .map((r) => r.output.split('\n')[0]?.trim())
    .find(
      (line) =>
        !!line &&
        (/Pull request #\d+/i.test(line) ||
          /Wrote .+ locally/i.test(line) ||
          /Stored \d+ (user_preferences|semantic_memories)/i.test(line) ||
          /github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i.test(line)),
    );
  if (evidenceLine) {
    lines.push(evidenceLine.slice(0, 280));
  }

  if (!lines.length) {
    return 'Graph verify passed, sir — work completed with tool evidence.';
  }
  return lines.join('\n');
}
