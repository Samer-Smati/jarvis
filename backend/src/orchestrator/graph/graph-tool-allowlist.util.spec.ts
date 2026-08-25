import { isExecuteToolAllowed, isResearchToolAllowed } from './graph-tool-allowlist.util';

describe('graph-tool-allowlist.util', () => {
  it('rejects write/PR in research before execute', () => {
    expect(
      isResearchToolAllowed({
        id: '1',
        name: 'self_improve',
        arguments: { action: 'write', path: 'a.ts', content: 'x' },
      }).allowed,
    ).toBe(false);
    expect(
      isResearchToolAllowed({
        id: '2',
        name: 'self_improve',
        arguments: { action: 'pull_request' },
      }).allowed,
    ).toBe(false);
    expect(
      isResearchToolAllowed({
        id: '3',
        name: 'remember_fact',
        arguments: { fact: 'x' },
      }).allowed,
    ).toBe(false);
  });

  it('allows read-only research tools', () => {
    expect(
      isResearchToolAllowed({
        id: '1',
        name: 'self_improve',
        arguments: { action: 'inspect', paths: ['a.ts'] },
      }).allowed,
    ).toBe(true);
    expect(
      isResearchToolAllowed({
        id: '2',
        name: 'brain',
        arguments: { action: 'query', query: 'x' },
      }).allowed,
    ).toBe(true);
    expect(
      isResearchToolAllowed({
        id: '3',
        name: 'web_search',
        arguments: { query: 'x' },
      }).allowed,
    ).toBe(true);
  });

  it('flags execute inspect outside research paths as needsMoreResearch', () => {
    const decision = isExecuteToolAllowed(
      {
        id: '1',
        name: 'self_improve',
        arguments: { action: 'inspect', path: 'backend/src/other.ts' },
      },
      ['backend/src/memory/memory.service.ts'],
    );
    expect(decision.allowed).toBe(false);
    expect(decision.needsMoreResearch).toBe(true);
  });
});
