import { ToolTurnRecord } from '../pr-claim-guard.util';

export type GraphNodeId = 'research' | 'execute' | 'verify';

export interface ResearchFindings {
  summary: string;
  filePaths: string[];
  facts: string[];
  evidenceSnippets: Array<{ source: string; excerpt: string }>;
  openQuestions: string[];
}

export interface ExecuteActionRecord {
  tool: string;
  action: string;
  path?: string;
  ok: boolean;
  outputExcerpt: string;
}

export interface ExecuteResult {
  actions: ExecuteActionRecord[];
  claimedDone: boolean;
  needsMoreResearch?: boolean;
  researchQuestions?: string[];
}

export interface VerifyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerifyResult {
  passed: boolean;
  checks: VerifyCheck[];
  failureReason?: string;
}

export interface GraphState {
  goal: string;
  conversationId: string;
  startedAt: number;
  deadlineAt: number;
  research?: ResearchFindings;
  execute?: ExecuteResult;
  verify?: VerifyResult;
  loopBackUsed: boolean;
  toolRecords: ToolTurnRecord[];
  nodeFailures: Array<{ node: GraphNodeId; reason: string }>;
}

export interface GraphNodeResult {
  ok: boolean;
  reason?: string;
  state: GraphState;
}

export function createInitialGraphState(input: {
  goal: string;
  conversationId: string;
  deadlineAt: number;
}): GraphState {
  return {
    goal: input.goal,
    conversationId: input.conversationId,
    startedAt: Date.now(),
    deadlineAt: input.deadlineAt,
    loopBackUsed: false,
    toolRecords: [],
    nodeFailures: [],
  };
}

export function emptyResearchFindings(extraQuestions: string[] = []): ResearchFindings {
  return {
    summary: '',
    filePaths: [],
    facts: [],
    evidenceSnippets: [],
    openQuestions: extraQuestions,
  };
}
