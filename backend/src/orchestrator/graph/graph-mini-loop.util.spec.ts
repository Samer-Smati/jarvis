import type { ChatMessage, LlmChatResult, ToolCall, ToolDefinition } from '../../llm/llm.types';
import {
  FINAL_JSON_USER_PROMPT,
  runGraphMiniLoop,
} from './graph-mini-loop.util';

const tools: ToolDefinition[] = [
  { name: 'self_improve', description: 'si', parameters: { type: 'object', properties: {} } },
];

describe('graph-mini-loop.util', () => {
  it('forces JSON synthesis after multiple tool rounds on the final iteration', async () => {
    let chatTurns = 0;
    const toolCallsSeen: string[] = [];
    const chatToolsPassed: number[] = [];
    const userPrompts: string[] = [];

    const chat = async (
      messages: ChatMessage[],
      turnTools: ToolDefinition[],
    ): Promise<LlmChatResult> => {
      chatTurns += 1;
      chatToolsPassed.push(turnTools.length);
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUser) {
        userPrompts.push(String(lastUser.content));
      }

      if (chatTurns <= 3) {
        return {
          content: '',
          toolCalls: [
            {
              id: `t${chatTurns}`,
              name: 'self_improve',
              arguments: { action: 'inspect', path: `f${chatTurns}.ts` },
            },
          ],
        };
      }

      expect(turnTools).toEqual([]);
      expect(String(lastUser?.content)).toContain('FINAL ITERATION');
      return {
        content: JSON.stringify({
          summary: 'scheduler gap',
          filePaths: ['f1.ts', 'f2.ts', 'f3.ts'],
          facts: ['no cron'],
          evidenceSnippets: [],
          openQuestions: [],
        }),
        toolCalls: [],
      };
    };

    const result = await runGraphMiniLoop({
      systemPrompt: 'RESEARCH node',
      userPrompt: 'Investigate crypto monitor',
      tools,
      deadlineAt: Date.now() + 60_000,
      maxIterations: 4,
      chat,
      runTool: async (call: ToolCall) => {
        toolCallsSeen.push(String(call.arguments?.path ?? ''));
        return { output: `inspected ${call.arguments?.path}` };
      },
    });

    expect(result.ok).toBe(true);
    expect(toolCallsSeen).toEqual(['f1.ts', 'f2.ts', 'f3.ts']);
    expect(chatTurns).toBe(4);
    expect(chatToolsPassed).toEqual([1, 1, 1, 0]);
    expect(userPrompts.some((p) => p.includes(FINAL_JSON_USER_PROMPT.slice(0, 20)))).toBe(true);
    expect(result.parsed).toEqual(
      expect.objectContaining({
        summary: 'scheduler gap',
        filePaths: ['f1.ts', 'f2.ts', 'f3.ts'],
      }),
    );
  });

  it('fails clearly when the final forced iteration still has no JSON', async () => {
    const result = await runGraphMiniLoop({
      systemPrompt: 'RESEARCH node',
      userPrompt: 'Investigate',
      tools,
      deadlineAt: Date.now() + 60_000,
      maxIterations: 2,
      chat: async (_messages, turnTools) => {
        if (turnTools.length) {
          return {
            content: '',
            toolCalls: [{ id: '1', name: 'self_improve', arguments: { action: 'inspect' } }],
          };
        }
        return { content: 'Still thinking in prose…', toolCalls: [] };
      },
      runTool: async () => ({ output: 'ok' }),
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/final iteration/i);
  });

  it('returns early JSON before the final iteration when the model synthesizes sooner', async () => {
    let turns = 0;
    const result = await runGraphMiniLoop({
      systemPrompt: 'RESEARCH node',
      userPrompt: 'Investigate',
      tools,
      deadlineAt: Date.now() + 60_000,
      maxIterations: 5,
      chat: async () => {
        turns += 1;
        if (turns === 1) {
          return {
            content: '',
            toolCalls: [{ id: '1', name: 'self_improve', arguments: { action: 'inspect' } }],
          };
        }
        return {
          content: '{"summary":"done","filePaths":["a.ts"],"facts":[],"evidenceSnippets":[],"openQuestions":[]}',
          toolCalls: [],
        };
      },
      runTool: async () => ({ output: 'ok' }),
    });

    expect(result.ok).toBe(true);
    expect(turns).toBe(2);
  });
});
