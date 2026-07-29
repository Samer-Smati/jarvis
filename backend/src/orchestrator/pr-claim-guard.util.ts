import { isConcreteSelfImproveRequest } from './fast-chat.util';

export const PULL_REQUEST_EVIDENCE = /Pull request #\d+/i;
export const GITHUB_PULL_URL = /github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i;

export interface ToolTurnRecord {
  toolName: string;
  action: string;
  output: string;
}

export interface PrClaimGuardInput {
  userText: string;
  candidate: string;
  toolRecords: ToolTurnRecord[];
}

export interface PrClaimGuardResult {
  blocked: boolean;
  text: string;
  shouldRetryWithTools: boolean;
  reason?: 'prose_pr_claim' | 'brain_ingest_conflation';
}

export function hasPullRequestEvidence(outputs: string[]): boolean {
  const combined = outputs.join('\n');
  return PULL_REQUEST_EVIDENCE.test(combined) || GITHUB_PULL_URL.test(combined);
}

export function userRequestedPullRequestOrCodeWork(userText: string): boolean {
  const t = userText.trim();
  if (!t) {
    return false;
  }
  if (isConcreteSelfImproveRequest(t)) {
    return true;
  }
  if (/\b(create|open|make|submit|prepare)\s+(the\s+)?(a\s+)?(pull\s+request|pr)\b/i.test(t)) {
    return true;
  }
  if (/\bopen\s+(the\s+)?pr\b/i.test(t)) {
    return true;
  }
  if (/\bpull_request\b/i.test(t)) {
    return true;
  }
  if (/\b(system prompt|personality\.ts)\b/i.test(t) && /\b(update|edit|integrat|pr|pull request|write)\b/i.test(t)) {
    return true;
  }
  if (/\bintegrat(e|ed|ing)\b/i.test(t) && /\b(workflow|system prompt|practice|code|repo)\b/i.test(t)) {
    return true;
  }
  if (/\b(give me|send|provide).{0,30}\b(github|pr url|pull request url)\b/i.test(t)) {
    return true;
  }
  if (/\bapproved\b/i.test(t) && /\b(system prompt|pull request|pr|open)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function responseAssertsPrOrCodeCompletion(text: string, userWantsPr: boolean): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  if (/\b(opened|created|staged).{0,48}\bpull[- ]?request\b/i.test(t)) {
    return true;
  }
  if (/\bpull[- ]?request.{0,48}\b(opened|created|ready|staged|named)\b/i.test(t)) {
    return true;
  }
  if (/\bPR (is )?(opened|created|ready|staged)\b/i.test(t)) {
    return true;
  }
  if (/\bsuccessfully integrated\b/i.test(t)) {
    return true;
  }
  if (/\bintegration (is )?complete\b/i.test(t)) {
    return true;
  }
  if (/\bwrote the targeted edits\b/i.test(t)) {
    return true;
  }
  if (/\b(system prompt|personality).{0,40}\b(updated|integrated|modified|added)\b/i.test(t)) {
    return true;
  }
  if (/\bready for your review\b/i.test(t) && /\b(pull|pr|integration)\b/i.test(t)) {
    return true;
  }
  if (/\binspect(ed)?.{0,40}\bwrote\b/i.test(t) && /\bpull[- ]?request\b/i.test(t)) {
    return true;
  }
  if (userWantsPr && /\bDone, sir\b/i.test(t) && /\b(pull|pr|integration|changes on github)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function responseClaimsPullRequestEvidence(text: string): boolean {
  return PULL_REQUEST_EVIDENCE.test(text) || GITHUB_PULL_URL.test(text);
}

const CODE_WORK_ACTIONS = new Set(['write', 'pull_request', 'apply_preset', 'commit', 'run_checks']);
const BRAIN_INGEST_ACTIONS = new Set(['ingest_url', 'ingest']);

export function onlyBrainIngestWithoutCodeWork(toolRecords: ToolTurnRecord[]): boolean {
  const hasBrainIngest = toolRecords.some(
    (r) => r.toolName === 'brain' && BRAIN_INGEST_ACTIONS.has(r.action),
  );
  const hasCodeWork = toolRecords.some(
    (r) => r.toolName === 'self_improve' && CODE_WORK_ACTIONS.has(r.action),
  );
  return hasBrainIngest && !hasCodeWork;
}

export function responseConflatesBrainIngestWithImplementation(text: string): boolean {
  return (
    /\b(successfully integrated|integration complete|system prompt (was )?updated|added to (the )?system prompt)\b/i.test(
      text,
    ) ||
    /\b(opened a pull|pull[- ]?request.{0,32}(opened|created|ready))\b/i.test(text) ||
    /\b(wrote the targeted edits|implemented the practice|integrated the practice)\b/i.test(text)
  );
}

export function buildBrainIngestConflationReply(): string {
  return [
    'Sorry, sir — I did not complete a code or pull-request integration.',
    '',
    'I only ingested documentation into the brain vault (brain ingest_url). That stores reference text — it does not edit backend/src/orchestrator/personality.ts or open a GitHub pull request.',
    '',
    'To integrate a practice into the system prompt, I must run self_improve: inspect → write → pull_request, and you should see "Pull request #N" or a github.com/.../pull/N URL from the tool output.',
    '',
    'Please ask me to retry the system-prompt PR when you are ready.',
  ].join('\n');
}

export function buildProsePrClaimReply(userWantsPr: boolean, toolSummary: string): string {
  const lines = [
    'Sorry, sir — I cannot report that work as complete.',
    '',
    'My reply claimed a pull request or code integration finished, but no tool output from this turn contains "Pull request #N" or a verifiable github.com/.../pull/N URL.',
  ];
  if (toolSummary) {
    lines.push('', `Tools that did run: ${toolSummary}`);
  }
  if (userWantsPr) {
    lines.push(
      '',
      'I will retry using self_improve tools (inspect → write → pull_request) if you send the request again — or say "retry the system prompt PR" now.',
    );
  } else {
    lines.push('', 'Please retry or tell me what to adjust.');
  }
  return lines.join('\n');
}

export function buildPrGuardRetrySystemPrompt(): string {
  return [
    'CRITICAL: Your previous assistant message claimed a pull request or code edit was completed without tool evidence.',
    'You MUST call self_improve tools — do NOT answer in prose only:',
    '1) self_improve action=inspect on the target file path',
    '2) self_improve action=write with path and content',
    '3) self_improve action=pull_request with branch, title, and message',
    'Only after pull_request tool output contains "Pull request #N" or a github.com/.../pull/N URL may you tell the user the PR is ready.',
    'If any tool fails, quote the exact error — never say done, integrated, or PR opened without that evidence.',
    'brain ingest_url only saves documentation to the wiki — it is NOT a system-prompt code change.',
  ].join(' ');
}

export function summarizeToolRecords(toolRecords: ToolTurnRecord[]): string {
  if (!toolRecords.length) {
    return 'none';
  }
  return toolRecords
    .map((r) => {
      const action = r.action ? `${r.action}` : r.toolName;
      return `${r.toolName}${action !== r.toolName ? `(${action})` : ''}`;
    })
    .join(', ');
}

export function applyPrClaimGuard(input: PrClaimGuardInput): PrClaimGuardResult {
  const { userText, candidate, toolRecords } = input;
  const text = candidate.trim();
  if (!text) {
    return { blocked: false, text: candidate, shouldRetryWithTools: false };
  }

  const userWantsPr = userRequestedPullRequestOrCodeWork(userText);
  const toolOutputs = toolRecords.map((r) => r.output);
  const hasEvidence = hasPullRequestEvidence(toolOutputs);
  const assertsCompletion = responseAssertsPrOrCodeCompletion(text, userWantsPr);
  const claimsEvidenceInProse = responseClaimsPullRequestEvidence(text);
  const toolSummary = summarizeToolRecords(toolRecords);

  if (onlyBrainIngestWithoutCodeWork(toolRecords) && responseConflatesBrainIngestWithImplementation(text)) {
    return {
      blocked: true,
      text: buildBrainIngestConflationReply(),
      shouldRetryWithTools: userWantsPr,
      reason: 'brain_ingest_conflation',
    };
  }

  if (!hasEvidence && (assertsCompletion || claimsEvidenceInProse)) {
    return {
      blocked: true,
      text: buildProsePrClaimReply(userWantsPr, toolSummary),
      shouldRetryWithTools: userWantsPr,
      reason: 'prose_pr_claim',
    };
  }

  return { blocked: false, text: candidate, shouldRetryWithTools: false };
}
