import { PermissionsService } from '../permissions/permissions.service';
import { GuardrailService } from '../guardrails/guardrail.service';
import { FeedbackService } from '../feedback/feedback.service';
import { LessonsService } from '../lessons/lessons.service';
import { BrainService } from '../brain/brain.service';
import { BrainOpsPauseService } from '../brain/brain-ops-pause.service';
import { LlmChatResult, LlmProvider } from '../llm/llm.types';
import { LlmService } from '../llm/llm.service';
import { TaskRouterService } from '../llm/task-router.service';
import { MemoryService } from '../memory/memory.service';
import { Skill } from '../skills/skill.interface';
import { SkillRegistry } from '../skills/skill.registry';
import { OrchestratorEmitter } from './orchestrator.events';
import { PersonalityService } from './personality.service';
import { OrchestratorService } from './orchestrator.service';

function emitterMock(): jest.Mocked<OrchestratorEmitter> {
  return {
    onToken: jest.fn(),
    onProgress: jest.fn(),
    onToolStart: jest.fn(),
    onToolEnd: jest.fn(),
    onConfirmationRequest: jest.fn(),
    onPermissionRequest: jest.fn(),
    onDone: jest.fn(),
    onError: jest.fn(),
  };
}

function waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (check()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe('OrchestratorService', () => {
  let llm: jest.Mocked<LlmProvider>;
  let llmService: jest.Mocked<Pick<LlmService, 'chatWithRoute'>>;
  let taskRouter: jest.Mocked<Pick<TaskRouterService, 'resolve' | 'recordUsage'>>;
  let brain: jest.Mocked<
    Pick<BrainService, 'getContextBlock' | 'remember' | 'learnFromTurn' | 'findUserEntityPage' | 'query'>
  >;
  let memory: jest.Mocked<
    Pick<
      MemoryService,
      | 'appendMessage'
      | 'loadConversation'
      | 'buildContext'
      | 'rememberFact'
      | 'rememberFactDetailed'
      | 'logEvent'
      | 'indexConversationTurn'
      | 'recallFacts'
      | 'listPreferences'
    >
  >;
  let brainOpsPause: jest.Mocked<Pick<BrainOpsPauseService, 'isPaused' | 'pause' | 'resume'>>;
  let guardrails: jest.Mocked<Pick<GuardrailService, 'requestConfirmation' | 'audit'>>;
  let permissions: jest.Mocked<Pick<PermissionsService, 'isGranted' | 'requestGrant'>>;
  let personality: jest.Mocked<Pick<PersonalityService, 'getActivePrompt'>>;
  let feedback: jest.Mocked<Pick<FeedbackService, 'logInteraction'>>;
  let lessons: jest.Mocked<Pick<LessonsService, 'recordRetrieval' | 'createDirect'>>;
  let webFetch: { fetchRawText: jest.Mock; fetchReadable: jest.Mock };
  let skill: Skill;
  let registry: SkillRegistry;

  const buildService = () =>
    new OrchestratorService(
      llm,
      llmService as unknown as LlmService,
      taskRouter as unknown as TaskRouterService,
      registry,
      memory as unknown as MemoryService,
      brain as unknown as BrainService,
      brainOpsPause as unknown as BrainOpsPauseService,
      guardrails as unknown as GuardrailService,
      permissions as unknown as PermissionsService,
      personality as unknown as PersonalityService,
      feedback as unknown as FeedbackService,
      lessons as unknown as LessonsService,
      webFetch as unknown as import('../integrations/web-fetch.service').WebFetchService,
    );

  beforeEach(() => {
    llm = { name: 'mock', chat: jest.fn() };
    llmService = {
      chatWithRoute: jest.fn(),
    };
    taskRouter = {
      resolve: jest.fn().mockReturnValue({
        task: 'quick_qa',
        runtime: 'desktop',
        route: { provider: 'mock' },
        reason: 'test',
      }),
      recordUsage: jest.fn(),
    };
    memory = {
      appendMessage: jest.fn().mockResolvedValue(undefined),
      loadConversation: jest.fn().mockResolvedValue({ messages: [], truncated: 0 }),
      buildContext: jest.fn().mockResolvedValue({
        facts: [],
        preferences: [],
        projects: [],
        conversationHits: [],
        lessons: [],
        lessonIds: [],
      }),
      rememberFact: jest.fn().mockResolvedValue({
        preferenceRows: [],
        semanticRows: [{ id: 'sem-1', text: 'User likes tea.', memoryType: 'fact' }],
      }),
      rememberFactDetailed: jest.fn().mockResolvedValue({
        preferenceRows: [],
        semanticRows: [{ id: 'sem-1', text: 'User likes tea.', memoryType: 'fact' }],
      }),
      logEvent: jest.fn().mockResolvedValue(undefined),
      indexConversationTurn: jest.fn().mockResolvedValue(undefined),
      recallFacts: jest.fn().mockResolvedValue([]),
      listPreferences: jest.fn().mockResolvedValue([]),
    };
    brain = {
      getContextBlock: jest.fn().mockResolvedValue(''),
      remember: jest.fn().mockResolvedValue('facts/example.md'),
      learnFromTurn: jest.fn().mockResolvedValue(undefined),
      findUserEntityPage: jest.fn().mockResolvedValue(null),
      query: jest.fn().mockResolvedValue({ hot: '', hits: [] }),
    };
    brainOpsPause = {
      isPaused: jest.fn().mockResolvedValue(false),
      pause: jest.fn().mockResolvedValue({ paused: true }),
      resume: jest.fn().mockResolvedValue({ paused: false }),
    };
    personality = {
      getActivePrompt: jest.fn().mockReturnValue('You are JARVIS.'),
    };
    feedback = {
      logInteraction: jest.fn().mockResolvedValue({ id: 'log-1' }),
    };
    lessons = {
      recordRetrieval: jest.fn().mockResolvedValue(undefined),
      createDirect: jest.fn().mockResolvedValue({ id: 'lesson-1' }),
    };
    webFetch = {
      fetchRawText: jest.fn(),
      fetchReadable: jest.fn(),
    };
    guardrails = {
      requestConfirmation: jest.fn(),
      audit: jest.fn().mockResolvedValue(undefined),
    };
    permissions = {
      isGranted: jest.fn().mockResolvedValue(true),
      requestGrant: jest.fn(),
    };
    skill = {
      name: 'test_skill',
      description: 'test',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: false,
      execute: jest.fn().mockResolvedValue({ success: true, output: 'skill output' }),
    };
    registry = new SkillRegistry([skill]);
  });

  it('streams a plain answer and stores it in memory', async () => {
    llmService.chatWithRoute.mockImplementation(async (_text, options): Promise<LlmChatResult> => {
      options.onToken?.('Hello');
      return { content: 'Hello', toolCalls: [] };
    });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'hi', emitter);

    expect(emitter.onToken).toHaveBeenCalledWith('Hello');
    expect(emitter.onDone).toHaveBeenCalledWith('Hello', expect.objectContaining({ interactionId: 'log-1' }));
    expect(memory.appendMessage).toHaveBeenCalledWith('c1', 'user', 'hi');
    expect(memory.appendMessage).toHaveBeenCalledWith('c1', 'assistant', 'Hello');
  });

  it('never exposes raw tool-call markup in the final assistant message', async () => {
    const markup =
      '<tool_call>web_search <arg_key>query</arg_key> <arg_value>best models</arg_value> </tool_call>';
    llmService.chatWithRoute.mockImplementation(async (_text, options): Promise<LlmChatResult> => {
      options.onToken?.(markup);
      return { content: markup, toolCalls: [] };
    });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'What are the best models right now?', emitter);

    const streamed = (emitter.onToken.mock.calls.map((c) => c[0]) as string[]).join('');
    expect(streamed).not.toMatch(/<tool_call>|arg_key|arg_value/i);

    const doneText = emitter.onDone.mock.calls[0]?.[0] as string;
    expect(doneText).not.toMatch(/<tool_call>|arg_key|arg_value/i);
  });

  it('executes tool calls and feeds results back to the LLM', async () => {
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'test_skill', arguments: { a: 1 } }],
      })
      .mockResolvedValueOnce({ content: 'Done, sir.', toolCalls: [] });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'run the skill', emitter);

    expect(skill.execute).toHaveBeenCalledWith({ a: 1 }, expect.objectContaining({ conversationId: 'c1' }));
    expect(emitter.onToolStart).toHaveBeenCalledWith('test_skill', { a: 1 });
    expect(emitter.onToolEnd).toHaveBeenCalledWith('test_skill', 'skill output', true);
    expect(emitter.onDone).toHaveBeenCalledWith('Done, sir.', expect.objectContaining({ interactionId: 'log-1' }));

    const secondCall = llmService.chatWithRoute.mock.calls[1][1];
    const toolMessage = secondCall.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('skill output');
  });

  it('skips execution when the user rejects a confirmation-gated skill', async () => {
    (skill as { requiresConfirmation: boolean }).requiresConfirmation = true;
    guardrails.requestConfirmation.mockResolvedValue(false);
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'test_skill', arguments: {} }],
      })
      .mockResolvedValueOnce({ content: 'Understood.', toolCalls: [] });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'do the risky thing', emitter);

    expect(skill.execute).not.toHaveBeenCalled();
    expect(guardrails.audit).toHaveBeenCalledWith('test_skill', 'chat', '{}', 'rejected');
    expect(emitter.onToolEnd).toHaveBeenCalledWith('test_skill', 'Rejected by user.', false);
  });

  it('requires confirmation for a high-risk action even when skill flag is false', async () => {
    const calendarSkill: Skill = {
      name: 'manage_calendar',
      description: 'calendar',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: false,
      riskFor: (args) => (String(args?.action ?? '') === 'delete' ? 'high' : 'low'),
      execute: jest.fn().mockResolvedValue({ success: true, output: 'deleted' }),
    };
    const calRegistry = new SkillRegistry([calendarSkill]);
    guardrails.requestConfirmation.mockResolvedValue(false);
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'manage_calendar', arguments: { action: 'delete', id: 'evt-1' } }],
      })
      .mockResolvedValueOnce({ content: 'Cancelled.', toolCalls: [] });

    const emitter = emitterMock();
    await new OrchestratorService(
      llm,
      llmService as unknown as LlmService,
      taskRouter as unknown as TaskRouterService,
      calRegistry,
      memory as unknown as MemoryService,
      brain as unknown as BrainService,
      brainOpsPause as unknown as BrainOpsPauseService,
      guardrails as unknown as GuardrailService,
      permissions as unknown as PermissionsService,
      personality as unknown as PersonalityService,
      feedback as unknown as FeedbackService,
      lessons as unknown as LessonsService,
      webFetch as unknown as import('../integrations/web-fetch.service').WebFetchService,
    ).handleUserMessage('c1', 'delete my meeting', emitter);

    expect(guardrails.requestConfirmation).toHaveBeenCalled();
    expect(calendarSkill.execute).not.toHaveBeenCalled();
  });

  it('stores facts via the built-in remember_fact tool without writing the brain vault', async () => {
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'remember_fact', arguments: { fact: 'User likes tea.' } }],
      })
      .mockResolvedValueOnce({ content: 'Noted.', toolCalls: [] });

    await buildService().handleUserMessage('c1', 'I like tea', emitterMock());

    expect(memory.rememberFactDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'User likes tea.', source: 'remember_fact' }),
    );
    expect(brain.remember).not.toHaveBeenCalled();
  });

  it('accepts remember_fact text alias and does not abort the turn on empty fact', async () => {
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'remember_fact', arguments: { text: 'User works in AdTech.' } }],
      })
      .mockResolvedValueOnce({ content: 'Stored.', toolCalls: [] });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'I work in AdTech', emitter);

    expect(memory.rememberFactDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'User works in AdTech.' }),
    );
    expect(emitter.onError).not.toHaveBeenCalled();
    expect(emitter.onDone).toHaveBeenCalled();
  });

  it('soft-fails empty remember_fact instead of surfacing Memory text is required', async () => {
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'remember_fact', arguments: {} }],
      })
      .mockResolvedValueOnce({ content: 'Understood.', toolCalls: [] });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'hello', emitter);

    expect(memory.rememberFact).not.toHaveBeenCalled();
    expect(emitter.onError).not.toHaveBeenCalledWith(
      'Memory text is required.',
      expect.anything(),
    );
    expect(emitter.onDone).toHaveBeenCalled();
  });

  it('reports an error when the LLM fails', async () => {
    llmService.chatWithRoute.mockRejectedValue(new Error('boom'));

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'hi', emitter);

    expect(emitter.onError).toHaveBeenCalledWith('boom', expect.objectContaining({ retryable: true }));
    expect(emitter.onDone).not.toHaveBeenCalled();
  });

  it('synthesizes a reply when tools succeed but the LLM returns empty prose', async () => {
    const brainSkill: Skill = {
      name: 'brain',
      description: 'brain',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: false,
      execute: jest.fn().mockResolvedValue({
        success: true,
        output:
          'Hot cache:\n\nMatching pages:\n- User Profile (entities/user-samer.md, score 9)\n  Samer is a full-stack engineer.',
      }),
    };
    registry = new SkillRegistry([brainSkill]);
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: '1',
            name: 'brain',
            arguments: { action: 'query', query: 'user profile name role preferences facts' },
          },
        ],
      })
      .mockResolvedValueOnce({ content: '', toolCalls: [] });

    const emitter = emitterMock();
    await buildService().handleUserMessage(
      'c1',
      'Please look up my stored profile facts in the vault.',
      emitter,
    );

    expect(emitter.onDone).toHaveBeenCalledWith(
      expect.stringMatching(/User Profile|full-stack engineer/i),
      expect.objectContaining({ interactionId: 'log-1' }),
    );
    expect(emitter.onError).not.toHaveBeenCalled();
    expect(memory.logEvent).toHaveBeenCalledWith(
      'chat',
      expect.stringMatching(/^Handled:/),
    );
  });

  it('recovers an empty LLM reply into a real answer on the next attempt', async () => {
    llmService.chatWithRoute
      .mockResolvedValueOnce({ content: '', toolCalls: [] })
      .mockResolvedValueOnce({
        content: 'Quantum foam is the jitter of spacetime at tiny scales, sir.',
        toolCalls: [],
      });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'Please summarize quantum foam briefly.', emitter);

    expect(llmService.chatWithRoute).toHaveBeenCalledTimes(2);
    expect(emitter.onDone).toHaveBeenCalledWith(
      expect.stringMatching(/Quantum foam/i),
      expect.objectContaining({ interactionId: 'log-1' }),
    );
    expect(emitter.onError).not.toHaveBeenCalledWith(
      expect.stringMatching(/without a visible reply/i),
      expect.anything(),
    );
  });

  it('answers about-me from the user entity page, not unrelated vault hits', async () => {
    brain.findUserEntityPage.mockResolvedValue({
      path: 'entities/user-samer-smati.md',
      title: 'Samer Smati',
      content: '# Samer Smati\nFull-stack engineer and JARVIS owner.',
      category: 'entity',
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      links: [],
    } as Awaited<ReturnType<BrainService['findUserEntityPage']>>);
    brain.query.mockResolvedValue({
      hot: '',
      hits: [
        {
          title: 'Hugging Face Models',
          path: 'sources/huggingface-models.md',
          category: 'source',
          excerpt: 'Catalog of open LLM weights on the Hub.',
          score: 99,
        },
      ],
    });

    const emitter = emitterMock();
    await buildService().handleUserMessage(
      'c1',
      "That's not about me — that's a Hugging Face models page. I asked what you know about ME specifically",
      emitter,
    );

    expect(brain.query).not.toHaveBeenCalled();
    expect(emitter.onDone).toHaveBeenCalledTimes(1);
    expect(emitter.onDone.mock.calls[0][0]).toMatch(/Samer Smati[\s\S]*Full-stack engineer/);
    expect(emitter.onDone.mock.calls[0][0]).not.toContain('Hugging Face');
    expect(memory.logEvent).toHaveBeenCalledWith('chat', 'About user query');
  });

  it('supersedes an in-flight run when a newer request id arrives', async () => {
    let resolveFirst: ((value: LlmChatResult) => void) | undefined;
    let firstCall = true;
    llmService.chatWithRoute.mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return { content: 'Second answer.', toolCalls: [] };
    });

    const service = buildService();
    const firstEmitter = emitterMock();
    const secondEmitter = emitterMock();

    const firstRun = service.handleUserMessage(
      'c1',
      'Explain quantum entanglement in detail for me.',
      firstEmitter,
      'chat',
      'desktop',
      undefined,
      undefined,
      'req-1',
    );
    await waitUntil(() => llmService.chatWithRoute.mock.calls.length >= 1);
    const secondRun = service.handleUserMessage(
      'c1',
      'Explain superconductivity in detail for me.',
      secondEmitter,
      'chat',
      'desktop',
      undefined,
      undefined,
      'req-2',
    );
    expect(typeof resolveFirst).toBe('function');
    resolveFirst!({ content: 'First answer.', toolCalls: [] });
    await Promise.allSettled([firstRun, secondRun]);

    expect(firstEmitter.onDone).toHaveBeenCalledWith('', { superseded: true });
    expect(secondEmitter.onDone).toHaveBeenCalledWith(
      'Second answer.',
      expect.objectContaining({ interactionId: 'log-1' }),
    );
    expect(memory.appendMessage).toHaveBeenCalledWith('c1', 'assistant', 'Second answer.');
    expect(memory.appendMessage).not.toHaveBeenCalledWith('c1', 'assistant', 'First answer.');
  });

  it('emits generic progress for skills without bespoke progress handling', async () => {
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'test_skill', arguments: { a: 1 } }],
      })
      .mockResolvedValueOnce({ content: 'Done, sir.', toolCalls: [] });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'run the skill', emitter);

    expect(emitter.onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'test_skill', toolName: 'test_skill' }),
    );
  });

  it('auto-approves a medium-risk action without blocking, but tags the audit trail', async () => {
    const mediumSkill: Skill = {
      name: 'trusted_skill',
      description: 'trusted',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: false,
      riskFor: () => 'medium',
      execute: jest.fn().mockResolvedValue({ success: true, output: 'done' }),
    };
    registry = new SkillRegistry([mediumSkill]);
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'trusted_skill', arguments: {} }],
      })
      .mockResolvedValueOnce({ content: 'Done, sir.', toolCalls: [] });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'do the trusted thing', emitter);

    expect(guardrails.requestConfirmation).not.toHaveBeenCalled();
    expect(mediumSkill.execute).toHaveBeenCalled();
    expect(guardrails.audit).toHaveBeenCalledWith('trusted_skill', 'chat', '{}', 'auto_trusted');
    expect(emitter.onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'auto_trusted', toolName: 'trusted_skill' }),
    );
  });

  it('appends a repeated-failure nudge after the same call fails twice', async () => {
    (skill.execute as jest.Mock).mockResolvedValue({ success: false, output: 'Error: still broken' });
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'test_skill', arguments: { a: 1 } }],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '2', name: 'test_skill', arguments: { a: 1 } }],
      })
      .mockResolvedValueOnce({ content: 'Gave up.', toolCalls: [] });

    await buildService().handleUserMessage('c1', 'retry the broken thing', emitterMock());

    const thirdCall = llmService.chatWithRoute.mock.calls[2][1];
    const toolMessages = thirdCall.messages.filter((m) => m.role === 'tool');
    expect(toolMessages[toolMessages.length - 1].content).toContain('failed 2 times');
  });
});
