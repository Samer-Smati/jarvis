export function isToolFailureOutput(output: string): boolean {
  const t = output.trim();
  if (!t) {
    return true;
  }
  if (/^error:/i.test(t)) {
    return true;
  }
  if (/unknown action/i.test(t)) {
    return true;
  }
  if (/permission denied/i.test(t)) {
    return true;
  }
  if (/rejected by user/i.test(t)) {
    return true;
  }
  if (/unknown skill/i.test(t)) {
    return true;
  }
  if (/not configured/i.test(t)) {
    return true;
  }
  if (/^skill ".+" failed/i.test(t)) {
    return true;
  }
  return false;
}

export function buildToolFailureReply(failures: Array<{ toolName: string; output: string }>): string {
  const lines = failures.map(
    (f) => `${f.toolName.replace(/_/g, ' ')} failed: ${f.output.split('\n')[0].trim()}`,
  );
  return `Sorry, sir — I could not complete that step.\n\n${lines.join('\n')}\n\nPlease retry or say what to adjust.`;
}

export const EMPTY_TURN_ERROR =
  'The request finished without a visible reply, sir — please retry.';

/** Spoken fallback when the model returns no prose and no usable tool output. */
export const EMPTY_TURN_FALLBACK =
  "Sorry, sir — I didn't catch a clear reply that time. Could you say that once more?";

/** When tools succeeded but the model returned no prose, turn tool output into a user-visible reply. */
export function buildSuccessfulToolReply(
  toolRecords: Array<{ toolName: string; action: string; output: string }>,
  lastToolOutput: string,
): string | null {
  const successful = toolRecords.filter((r) => r.output.trim() && !isToolFailureOutput(r.output));
  const primary = successful[successful.length - 1];
  const raw = (primary?.output || lastToolOutput).trim();
  if (!raw || isToolFailureOutput(raw)) {
    return null;
  }

  const toolLabel = (primary?.toolName ?? 'tool').replace(/_/g, ' ');
  const action = primary?.action?.trim();

  // self_improve inspect returns raw source code — dumping it as if it were the answer to the
  // user's question (which is what this fallback does for every other tool) reads as a
  // non-answer. Say plainly that the model ran out of steps instead of presenting code as prose.
  if (primary?.toolName === 'self_improve' && action === 'inspect') {
    return "Sir, I gathered the relevant code but ran out of steps before I could summarize it — could you ask again, a bit more specifically?";
  }

  const clipped = raw.length > 1200 ? `${raw.slice(0, 1200).trimEnd()}…` : raw;
  const header = action
    ? `Sir, here is what ${toolLabel} (${action}) returned:`
    : `Sir, here is what ${toolLabel} returned:`;
  return `${header}\n\n${clipped}`;
}
