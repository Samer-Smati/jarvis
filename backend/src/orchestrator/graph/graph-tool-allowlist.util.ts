import { ToolCall, ToolDefinition } from '../../llm/llm.types';

export type GraphNodeAllowlistKind = 'research' | 'execute';

const RESEARCH_BRAIN = new Set(['query', 'get_page', 'graph']);
const RESEARCH_SELF_IMPROVE = new Set(['inspect', 'status', 'verify_responsive']);

const EXECUTE_SELF_IMPROVE = new Set([
  'write',
  'pull_request',
  'run_checks',
  'apply_preset',
  'commit',
  'inspect',
  'status',
]);

export interface AllowlistDecision {
  allowed: boolean;
  reason?: string;
  needsMoreResearch?: boolean;
  researchPath?: string;
}

export function isResearchToolAllowed(call: ToolCall): AllowlistDecision {
  const name = call.name;
  const action = String(call.arguments?.action ?? '').trim();

  if (name === 'web_search') {
    return { allowed: true };
  }
  if (name === 'brain') {
    if (RESEARCH_BRAIN.has(action)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Research node denies brain action "${action || '(empty)'}" (read-only: query|get_page|graph).`,
    };
  }
  if (name === 'self_improve') {
    if (RESEARCH_SELF_IMPROVE.has(action)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Research node denies self_improve action "${action || '(empty)'}" (read-only: inspect|status|verify_responsive).`,
    };
  }
  if (name === 'remember_fact') {
    return { allowed: false, reason: 'Research node denies remember_fact (mutation).' };
  }
  return { allowed: false, reason: `Research node denies tool "${name}".` };
}

export function isExecuteToolAllowed(
  call: ToolCall,
  allowedPaths: string[],
): AllowlistDecision {
  const name = call.name;
  const action = String(call.arguments?.action ?? '').trim();
  const path = typeof call.arguments?.path === 'string' ? call.arguments.path : '';

  if (name === 'remember_fact') {
    return { allowed: true };
  }
  if (name === 'self_improve') {
    if (!EXECUTE_SELF_IMPROVE.has(action)) {
      return {
        allowed: false,
        reason: `Execute node denies self_improve action "${action || '(empty)'}".`,
      };
    }
    if (action === 'inspect' || action === 'write') {
      if (path && allowedPaths.length && !pathAllowed(path, allowedPaths)) {
        return {
          allowed: false,
          needsMoreResearch: true,
          researchPath: path,
          reason: `Path "${path}" is outside research findings; needs more research.`,
        };
      }
    }
    return { allowed: true };
  }
  return { allowed: false, reason: `Execute node denies tool "${name}".` };
}

export function pathAllowed(path: string, allowedPaths: string[]): boolean {
  const norm = path.replace(/\\/g, '/').toLowerCase();
  return allowedPaths.some((p) => {
    const ap = p.replace(/\\/g, '/').toLowerCase();
    return norm === ap || norm.endsWith('/' + ap) || norm.includes(ap) || ap.includes(norm);
  });
}

export function filterToolDefinitionsForNode(
  kind: GraphNodeAllowlistKind,
  all: ToolDefinition[],
): ToolDefinition[] {
  if (kind === 'research') {
    return all.filter((t) => t.name === 'web_search' || t.name === 'brain' || t.name === 'self_improve');
  }
  return all.filter((t) => t.name === 'self_improve' || t.name === 'remember_fact');
}

export function denyMessage(decision: AllowlistDecision): string {
  return `Error: ${decision.reason ?? 'tool not allowed in this graph node.'}`;
}
