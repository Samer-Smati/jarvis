export function toolStatusLabel(toolName: string, args?: Record<string, unknown>): string {
  if (toolName === 'self_improve') {
    const action = String(args?.action ?? '');
    const path = typeof args?.path === 'string' ? args.path : '';
    switch (action) {
      case 'status':
        return 'Checking upgrade status…';
      case 'inspect':
        return path ? `Inspecting ${path}…` : 'Inspecting project…';
      case 'write':
        return path ? `Writing ${path}…` : 'Writing changes…';
      case 'run_checks':
        return 'Running build checks…';
      case 'apply_preset':
        return 'Applying preset…';
      case 'commit':
        return 'Committing changes…';
      case 'pull_request':
        return 'Opening pull request…';
      default:
        return 'Self-upgrade…';
    }
  }
  if (toolName === 'brain') {
    const action = String(args?.action ?? '');
    switch (action) {
      case 'graph':
        return 'Opening brain graph…';
      case 'query':
        return 'Searching brain…';
      case 'remember':
        return 'Remembering in brain…';
      case 'ingest':
        return 'Ingesting source…';
      case 'ingest_url':
        return 'Reading link…';
      case 'cleanup':
        return 'Cleaning up brain vault…';
      case 'consolidate':
        return 'Linking brain pages…';
      default:
        return 'Brain…';
    }
  }
  if (toolName === 'web_search') {
    return 'Searching the web…';
  }
  if (toolName === 'remember_fact') {
    return 'Storing fact…';
  }
  return `Running ${toolName.replace(/_/g, ' ')}…`;
}
