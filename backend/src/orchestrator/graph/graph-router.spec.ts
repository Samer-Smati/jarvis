import type { ChatMessage, LlmChatResult, ToolCall, ToolDefinition } from '../../llm/llm.types';
import { OrchestratorEmitter } from '../orchestrator.events';
import { runComplexGraphTask } from './graph-router';

function mockEmitter(): OrchestratorEmitter {
  return {
    onToken: () => undefined,
    onToolStart: () => undefined,
    onToolEnd: () => undefined,
    onConfirmationRequest: () => undefined,
    onPermissionRequest: () => undefined,
    onDone: () => undefined,
    onError: () => undefined,
  };
}

const tools: ToolDefinition[] = [
  { name: 'self_improve', description: 'si', parameters: { type: 'object', properties: {} } },
  { name: 'web_search', description: 'ws', parameters: { type: 'object', properties: {} } },
  { name: 'brain', description: 'b', parameters: { type: 'object', properties: {} } },
  { name: 'remember_fact', description: 'rf', parameters: { type: 'object', properties: {} } },
];

describe('graph-router', () => {
  it('runs happy path research → execute → verify', async () => {
    const calls: string[] = [];
    const chat = async (messages: ChatMessage[]): Promise<LlmChatResult> => {
      const system = String(messages[0]?.content ?? '');
      const last = messages[messages.length - 1];
      if (system.includes('RESEARCH node')) {
        if (last?.role === 'tool') {
          return {
            content: JSON.stringify({
              summary: 'Bug is in foo.ts null check',
              filePaths: ['backend/src/foo.ts'],
              facts: ['null check missing'],
              evidenceSnippets: [{ source: 'inspect', excerpt: 'if (x)' }],
              openQuestions: [],
            }),
            toolCalls: [],
          };
        }
        calls.push('research-tool');
        return {
          content: '',
          toolCalls: [
            {
              id: 'r1',
              name: 'self_improve',
              arguments: { action: 'inspect', path: 'backend/src/foo.ts' },
            },
          ],
        };
      }
      if (system.includes('EXECUTE node')) {
        if (last?.role === 'tool') {
          return {
            content: JSON.stringify({
              actions: [
                {
                  tool: 'self_improve',
                  action: 'write',
                  path: 'backend/src/foo.ts',
                  ok: true,
                  outputExcerpt: 'Wrote',
                },
                {
                  tool: 'self_improve',
                  action: 'pull_request',
                  ok: true,
                  outputExcerpt: 'PR',
                },
              ],
              claimedDone: true,
            }),
            toolCalls: [],
          };
        }
        calls.push('execute-tool');
        return {
          content: '',
          toolCalls: [
            {
              id: 'e1',
              name: 'self_improve',
              arguments: { action: 'write', path: 'backend/src/foo.ts', content: 'fixed' },
            },
            {
              id: 'e2',
              name: 'self_improve',
              arguments: { action: 'pull_request', title: 'fix foo', message: 'fix' },
            },
          ],
        };
      }
      return { content: '{}', toolCalls: [] };
    };

    const executeToolCall = async (call: ToolCall): Promise<string> => {
      if (call.arguments?.action === 'inspect') {
        return 'File backend/src/foo.ts:\n```\nif (x)\n```';
      }
      if (call.arguments?.action === 'write') {
        return 'Wrote backend/src/foo.ts locally (40 bytes). Run run_checks then commit or pull_request.';
      }
      if (call.arguments?.action === 'pull_request') {
        return 'Pull request #12 opened: https://github.com/Samer-Smati/jarvis/pull/12';
      }
      return 'ok';
    };

    const text = await runComplexGraphTask({
      goal: 'Debug foo and open a PR',
      conversationId: 'c1',
      trigger: 't1',
      deadlineAt: Date.now() + 120_000,
      emitter: mockEmitter(),
      allTools: tools,
      chat,
      executeToolCall,
      audit: async () => undefined,
    });

    expect(calls).toEqual(['research-tool', 'execute-tool']);
    expect(text).toMatch(/Pull request #12|Bug is in foo/i);
  });

  it('loop-backs once when execute needs more research', async () => {
    let researchCount = 0;
    let executeCount = 0;

    const chat = async (messages: ChatMessage[]): Promise<LlmChatResult> => {
      const system = String(messages[0]?.content ?? '');
      if (system.includes('RESEARCH node')) {
        researchCount += 1;
        const paths =
          researchCount === 1 ? ['backend/src/a.ts'] : ['backend/src/a.ts', 'backend/src/b.ts'];
        return {
          content: JSON.stringify({
            summary: `round ${researchCount}`,
            filePaths: paths,
            facts: [],
            evidenceSnippets: [],
            openQuestions: [],
          }),
          toolCalls: [],
        };
      }
      if (system.includes('EXECUTE node')) {
        executeCount += 1;
        if (executeCount === 1) {
          return {
            content: JSON.stringify({
              actions: [],
              claimedDone: false,
              needsMoreResearch: true,
              researchQuestions: ['Need backend/src/b.ts'],
            }),
            toolCalls: [],
          };
        }
        const last = messages[messages.length - 1];
        if (last?.role !== 'tool') {
          return {
            content: '',
            toolCalls: [
              {
                id: 'w1',
                name: 'self_improve',
                arguments: { action: 'write', path: 'backend/src/b.ts', content: 'x' },
              },
              {
                id: 'p1',
                name: 'self_improve',
                arguments: { action: 'pull_request', title: 'fix', message: 'fix' },
              },
            ],
          };
        }
        return {
          content: JSON.stringify({
            actions: [
              { tool: 'self_improve', action: 'write', ok: true, outputExcerpt: 'Wrote' },
              { tool: 'self_improve', action: 'pull_request', ok: true, outputExcerpt: 'PR' },
            ],
            claimedDone: true,
          }),
          toolCalls: [],
        };
      }
      return { content: '{}', toolCalls: [] };
    };

    const executeToolCall = async (call: ToolCall): Promise<string> => {
      if (call.arguments?.action === 'write') {
        return 'Wrote backend/src/b.ts locally (1 bytes).';
      }
      if (call.arguments?.action === 'pull_request') {
        return 'Pull request #3 opened: https://github.com/x/y/pull/3';
      }
      return 'ok';
    };

    const text = await runComplexGraphTask({
      goal: 'Investigate and fix b.ts with a PR',
      conversationId: 'c1',
      trigger: 't1',
      deadlineAt: Date.now() + 120_000,
      emitter: mockEmitter(),
      allTools: tools,
      chat,
      executeToolCall,
      audit: async () => undefined,
    });

    expect(researchCount).toBe(2);
    expect(executeCount).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/Pull request #3|round/i);
  });

  it('short-circuits on verify failure', async () => {
    const chat = async (messages: ChatMessage[]): Promise<LlmChatResult> => {
      const system = String(messages[0]?.content ?? '');
      if (system.includes('RESEARCH node')) {
        return {
          content: JSON.stringify({
            summary: 'found issue',
            filePaths: ['a.ts'],
            facts: [],
            evidenceSnippets: [],
            openQuestions: [],
          }),
          toolCalls: [],
        };
      }
      return {
        content: JSON.stringify({
          actions: [
            { tool: 'self_improve', action: 'pull_request', ok: true, outputExcerpt: 'claimed' },
          ],
          claimedDone: true,
        }),
        toolCalls: [],
      };
    };

    const text = await runComplexGraphTask({
      goal: 'Debug and open a PR',
      conversationId: 'c1',
      trigger: 't1',
      deadlineAt: Date.now() + 120_000,
      emitter: mockEmitter(),
      allTools: tools,
      chat,
      executeToolCall: async () => 'ok',
      audit: async () => undefined,
    });

    expect(text).toMatch(/Graph stopped at the verify node/i);
    expect(text).toMatch(/Missing Pull request|PR-claim|write/i);
  });
});
