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
