export function normalizeSelfImproveArgs(args: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...args };
  const action = String(merged.action ?? '').trim();
  if (action) {
    return merged;
  }
  if (merged.preset) {
    merged.action = 'apply_preset';
    return merged;
  }
  if (merged.content && merged.path) {
    merged.action = 'write';
    return merged;
  }
  if (merged.path || merged.paths) {
    merged.action = 'inspect';
    return merged;
  }
  if (merged.title || merged.branch || merged.message) {
    merged.action = 'pull_request';
    return merged;
  }
  return merged;
}

export function isSelfImproveArgsMissingAction(args: Record<string, unknown>): boolean {
  return !String(args.action ?? '').trim();
}
