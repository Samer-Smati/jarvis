import { toolStatusLabel } from './tool-status-label.util';

describe('toolStatusLabel', () => {
  it('labels web_search and brain actions', () => {
    expect(toolStatusLabel('web_search')).toBe('Searching the web…');
    expect(toolStatusLabel('brain', { action: 'cleanup' })).toBe('Cleaning up brain vault…');
  });

  it('labels self_improve actions with path', () => {
    expect(toolStatusLabel('self_improve', { action: 'inspect', path: 'src/foo.ts' })).toContain(
      'src/foo.ts',
    );
  });
});
