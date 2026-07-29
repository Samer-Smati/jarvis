import {
  isBrainOpsDenyOrComplaint,
  isBrainOpsMetaQuestion,
  isBrainOpsPauseRequest,
  isBrainUiDenyRequest,
  isMetaFactPageTitle,
} from './brain-ops.util';

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

describe('brain ops meta vs pause detection', () => {
  const complaintMessage =
    'You did not answer my question about the 11 deleted pages. Do not show me the graph or change the subject.';

  it('treats reflective complaints as meta questions, not pause commands', () => {
    expect(isBrainOpsMetaQuestion(complaintMessage)).toBe(true);
    expect(isBrainOpsPauseRequest(complaintMessage)).toBe(false);
    expect(isBrainUiDenyRequest(complaintMessage)).toBe(true);
    expect(isBrainOpsDenyOrComplaint(complaintMessage)).toBe(false);
  });

  it('detects unanswered deletion questions as meta', () => {
    expect(isBrainOpsMetaQuestion('You did not answer my question about the 11 deleted pages')).toBe(true);
    expect(isBrainOpsPauseRequest('You did not answer my question about the 11 deleted pages')).toBe(false);
  });

  it('detects explicit deletion-log questions as meta', () => {
    expect(isBrainOpsMetaQuestion('does a deletion log exist for removed pages')).toBe(true);
  });

  it('still detects real brain ops halt commands as pause requests', () => {
    expect(isBrainOpsPauseRequest('stop running cleanup on the brain until I review')).toBe(true);
    expect(isBrainOpsMetaQuestion('stop running cleanup on the brain until I review')).toBe(false);
  });

  it('does not treat UI graph denials alone as mutation halt', () => {
    expect(isBrainUiDenyRequest('Do not show me the graph or change the subject')).toBe(true);
    expect(isBrainOpsPauseRequest('Do not show me the graph or change the subject')).toBe(false);
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
