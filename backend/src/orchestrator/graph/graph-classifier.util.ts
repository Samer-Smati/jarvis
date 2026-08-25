import {
  isCodeArchitectureQuestion,
  isConcreteSelfImproveRequest,
  isFastChatTurn,
  isPlanOnlyRequest,
} from '../fast-chat.util';

export type GraphClassifyRoute = 'graph' | 'flat';

export interface GraphClassifyResult {
  route: GraphClassifyRoute;
  reason: string;
  researchHit: boolean;
  mutationHit: boolean;
  partialComplexSignals: boolean;
}

const RESEARCH_SIGNAL =
  /\b(investigate|debug|root[- ]?cause|diagnose|find(?:\s+out)?\s+why|look\s+into|trace)\b/i;

const MUTATION_VERIFY =
  /\b(fix|patch|implement|write|open\s+(a\s+)?pr|pull\s*request|verify|prove)\b/i;

const CODE_CONTEXT = /\b(code|repo|jarvis|bug|file|backend|frontend|typescript|self[_ ]?improve|pr)\b/i;

const EXPLICIT_COMPLEX =
  /\b(debug\s+and\s+open\s+(a\s+)?pr|investigate\b.{0,80}\band\s+fix|find\s+and\s+fix|find\b.{0,60}\band\s+fix)\b/i;

function hasResearchSignal(text: string): boolean {
  if (RESEARCH_SIGNAL.test(text)) {
    return true;
  }
  if (/\binspect\b/i.test(text) && CODE_CONTEXT.test(text)) {
    return true;
  }
  if (/\bfind\b.{0,40}\band\b/i.test(text) && CODE_CONTEXT.test(text)) {
    return true;
  }
  return false;
}

function hasMutationVerifySignal(text: string): boolean {
  if (isConcreteSelfImproveRequest(text)) {
    return true;
  }
  if (EXPLICIT_COMPLEX.test(text)) {
    return true;
  }
  if (MUTATION_VERIFY.test(text) && CODE_CONTEXT.test(text)) {
    return true;
  }
  return false;
}

/**
 * AC1: complex = research signal AND mutation/verify signal.
 * Plan-only / architecture-answer / fast chat stay on the flat loop.
 */
export function classifyGraphTask(text: string): GraphClassifyResult {
  const t = text.trim();
  if (!t) {
    return {
      route: 'flat',
      reason: 'empty',
      researchHit: false,
      mutationHit: false,
      partialComplexSignals: false,
    };
  }

  if (isFastChatTurn(t)) {
    return {
      route: 'flat',
      reason: 'fast_chat',
      researchHit: false,
      mutationHit: false,
      partialComplexSignals: false,
    };
  }

  if (isPlanOnlyRequest(t) || isCodeArchitectureQuestion(t)) {
    return {
      route: 'flat',
      reason: 'plan_only_or_architecture',
      researchHit: hasResearchSignal(t),
      mutationHit: hasMutationVerifySignal(t),
      partialComplexSignals: hasResearchSignal(t) || hasMutationVerifySignal(t),
    };
  }

  const researchHit = hasResearchSignal(t);
  const mutationHit = hasMutationVerifySignal(t);

  if (researchHit && mutationHit) {
    return {
      route: 'graph',
      reason: 'research_and_mutation',
      researchHit,
      mutationHit,
      partialComplexSignals: false,
    };
  }

  return {
    route: 'flat',
    reason: researchHit || mutationHit ? 'partial_complex_signals' : 'simple',
    researchHit,
    mutationHit,
    partialComplexSignals: researchHit || mutationHit,
  };
}

export function isComplexGraphTask(text: string): boolean {
  return classifyGraphTask(text).route === 'graph';
}
