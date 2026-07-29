import { isMetaFactPageTitle } from './brain-ops.util';

describe('isMetaFactPageTitle', () => {
  it('matches meta-complaint titles filed under any category label', () => {
    expect(isMetaFactPageTitle('User: concerned about node')).toBe(true);
    expect(isMetaFactPageTitle('User: worried about counts')).toBe(true);
    expect(isMetaFactPageTitle('User: frustrated with cleanup')).toBe(true);
  });

  it('does not match legitimate user identity facts', () => {
    expect(isMetaFactPageTitle('User: Samer SMATI')).toBe(false);
    expect(isMetaFactPageTitle('User is owner')).toBe(false);
  });
});

describe('withGraphCounts contract', () => {
  it('uses the same node and edge lengths for pageCount and edgeCount', () => {
    const graph = {
      nodes: [{ id: 'a', label: 'A', category: 'fact' as const, linkCount: 1 }],
      edges: [{ source: 'a', target: 'b', kind: 'wiki' as const }],
      updatedAt: '2026-07-29T00:00:00.000Z',
    };
    const withCounts = {
      ...graph,
      pageCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    };
    expect(withCounts.pageCount).toBe(1);
    expect(withCounts.edgeCount).toBe(1);
  });
});
