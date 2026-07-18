import { PermissionsService } from '../permissions/permissions.service';
import { GuardrailService } from '../guardrails/guardrail.service';
import { LlmChatResult, LlmProvider } from '../llm/llm.types';
import { MemoryService } from '../memory/memory.service';
import { Skill } from '../skills/skill.interface';
import { SkillRegistry } from '../skills/skill.registry';
import { OrchestratorEmitter } from './orchestrator.events';
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
  let memory: jest.Mocked<Pick<MemoryService, 'appendMessage' | 'loadConversation' | 'recallFacts' | 'rememberFact' | 'logEvent'>>;
  let guardrails: jest.Mocked<Pick<GuardrailService, 'requestConfirmation' | 'audit'>>;
  let permissions: jest.Mocked<Pick<PermissionsService, 'isGranted' | 'requestGrant'>>;
  let skill: Skill;
  let registry: SkillRegistry;

  const buildService = () =>
    new OrchestratorService(
      llm,
      registry,
      memory as unknown as MemoryService,
      guardrails as unknown as GuardrailService,
      permissions as unknown as PermissionsService,
    );

  beforeEach(() => {
    llm = { name: 'mock', chat: jest.fn() };
    memory = {
      appendMessage: jest.fn().mockResolvedValue(undefined),
      loadConversation: jest.fn().mockResolvedValue({ messages: [], truncated: 0 }),
      recallFacts: jest.fn().mockResolvedValue([]),
      rememberFact: jest.fn().mockResolvedValue(undefined),
      logEvent: jest.fn().mockResolvedValue(undefined),
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
    llm.chat.mockImplementation(async (options): Promise<LlmChatResult> => {
      options.onToken?.('Hello');
      return { content: 'Hello', toolCalls: [] };
    });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'hi', emitter);

    expect(emitter.onToken).toHaveBeenCalledWith('Hello');
    expect(emitter.onDone).toHaveBeenCalledWith('Hello');
    expect(memory.appendMessage).toHaveBeenCalledWith('c1', 'user', 'hi');
    expect(memory.appendMessage).toHaveBeenCalledWith('c1', 'assistant', 'Hello');
  });

  it('executes tool calls and feeds results back to the LLM', async () => {
    llm.chat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'test_skill', arguments: { a: 1 } }],
      })
      .mockResolvedValueOnce({ content: 'Done, sir.', toolCalls: [] });

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'run the skill', emitter);

    expect(skill.execute).toHaveBeenCalledWith({ a: 1 }, { conversationId: 'c1' });
    expect(emitter.onToolStart).toHaveBeenCalledWith('test_skill', { a: 1 });
    expect(emitter.onToolEnd).toHaveBeenCalledWith('test_skill', 'skill output', true);
    expect(emitter.onDone).toHaveBeenCalledWith('Done, sir.');

    const secondCall = llm.chat.mock.calls[1][0];
    const toolMessage = secondCall.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toBe('skill output');
  });

  it('skips execution when the user rejects a confirmation-gated skill', async () => {
    (skill as { requiresConfirmation: boolean }).requiresConfirmation = true;
    guardrails.requestConfirmation.mockResolvedValue(false);
    llm.chat
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
    llm.chat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'manage_calendar', arguments: { action: 'delete', id: 'evt-1' } }],
      })
      .mockResolvedValueOnce({ content: 'Cancelled.', toolCalls: [] });

    const emitter = emitterMock();
    await new OrchestratorService(
      llm,
      calRegistry,
      memory as unknown as MemoryService,
      guardrails as unknown as GuardrailService,
    ).handleUserMessage('c1', 'delete my meeting', emitter);

    expect(guardrails.requestConfirmation).toHaveBeenCalled();
    expect(calendarSkill.execute).not.toHaveBeenCalled();
  });

  it('stores facts via the built-in remember_fact tool', async () => {
    llm.chat
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: '1', name: 'remember_fact', arguments: { fact: 'User likes tea.' } }],
      })
      .mockResolvedValueOnce({ content: 'Noted.', toolCalls: [] });

    await buildService().handleUserMessage('c1', 'I like tea', emitterMock());

    expect(memory.rememberFact).toHaveBeenCalledWith('User likes tea.');
  });

  it('reports an error when the LLM fails', async () => {
    llm.chat.mockRejectedValue(new Error('boom'));

    const emitter = emitterMock();
    await buildService().handleUserMessage('c1', 'hi', emitter);

    expect(emitter.onError).toHaveBeenCalledWith('boom');
    expect(emitter.onDone).not.toHaveBeenCalled();
  });
});
