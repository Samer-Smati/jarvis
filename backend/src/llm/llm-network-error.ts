/** Map low-level Node fetch failures to actionable LLM offline messages. */
export function describeLlmNetworkError(
  error: unknown,
  providerLabel: string,
  hint: string,
): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower === 'fetch failed' ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('abort')
  ) {
    return `${providerLabel} is offline or unreachable. ${hint}`;
  }
  return message;
}
