import { PermissionsService } from '../permissions/permissions.service';
import { GuardrailService } from '../guardrails/guardrail.service';
import { FeedbackService } from '../feedback/feedback.service';
import { BrainService } from '../brain/brain.service';
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
    onToolStart: jest.fn(),
    onToolEnd: jest.fn(),
    onConfirmationRequest: jest.fn(),
    onPermissionRequest: jest.fn(),
    onDone: jest.fn(),
    onError: jest.fn(),
  };
}

describe('OrchestratorService', () => {
  let llm: jest.Mocked<LlmProvider>;
  let llmService: jest.Mocked<Pick<LlmService, 'chatWithRoute'>>;
  let taskRouter: jest.Mocked<Pick<TaskRouterService, 'resolve' | 'recordUsage'>>;
  let memory: jest.Mocked<
    Pick<
      MemoryService,
      | 'appendMessage'
      | 'loadConversation'
      | 'buildContext'
      | 'rememberFact'
      | 'logEvent'
      | 'indexConversationTurn'
    >
  >;
  let brain: jest.Mocked<Pick<BrainService, 'getContextBlock' | 'remember' | 'learnFromTurn'>>;
  let guardrails: jest.Mocked<Pick<GuardrailService, 'requestConfirmation' | 'audit'>>;
  let permissions: jest.Mocked<Pick<PermissionsService, 'isGranted' | 'requestGrant'>>;
  let personality: jest.Mocked<Pick<PersonalityService, 'getActivePrompt'>>;
  let feedback: jest.Mocked<Pick<FeedbackService, 'logInteraction'>>;
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
      guardrails as unknown as GuardrailService,
      permissions as unknown as PermissionsService,
      personality as unknown as PersonalityService,
      feedback as unknown as FeedbackService,
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
      buildContext: jest.fn().mockResolvedValue({ facts: [], preferences: [], projects: [], conversationHits: [] }),
      rememberFact: jest.fn().mockResolvedValue(undefined),
      logEvent: jest.fn().mockResolvedValue(undefined),
      indexConversationTurn: jest.fn().mockResolvedValue(undefined),
    };
    brain = {
      getContextBlock: jest.fn().mockResolvedValue(''),
      remember: jest.fn().mockResolvedValue(undefined),
      learnFromTurn: jest.fn().mockResolvedValue(undefined),
    };
    personality = {
      getActivePrompt: jest.fn().mockReturnValue('You are JARVIS.'),
    };
    feedback = {
      logInteraction: jest.fn().mockResolvedValue({ id: 'log-1' }),
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

  it('requires confirmation for calendar delete even when skill flag is false', async () => {
    const calendarSkill: Skill = {
      name: 'manage_calendar',
      description: 'calendar',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: false,
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
      guardrails as unknown as GuardrailService,
      permissions as unknown as PermissionsService,
      personality as unknown as PersonalityService,
      feedback as unknown as FeedbackService,
    ).handleUserMessage('c1', 'delete my meeting', emitter);

    expect(guardrails.requestConfirmation).toHaveBeenCalled();
    expect(calendarSkill.execute).not.toHaveBeenCalled();
  });

  it('stores facts via the built-in remember_fact tool', async () => {
    llmService.chatWithRoute
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'remember_fact', arguments: { fact: 'User likes tea.' } }],
      })
      .mockResolvedValueOnce({ content: 'Noted.', toolCalls: [] });

    await buildService().handleUserMessage('c1', 'I like tea', emitterMock());

    expect(memory.rememberFact).toHaveBeenCalledWith('User likes tea.');
  });

  it('reports an error when the LLM fails', async () => {
    llmService.chatWithRoute.mockRejectedValue(new Error('boom'));

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'hi', emitter);

    expect(emitter.onError).toHaveBeenCalledWith('boom');
    expect(emitter.onDone).not.toHaveBeenCalled();
  });
});
