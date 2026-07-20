import { Inject, Injectable, Logger } from '@nestjs/common';
import { GuardrailService } from '../guardrails/guardrail.service';
import type { ChatMessage, LlmProvider, ToolCall, ToolDefinition } from '../llm/llm.types';
import { LLM_PROVIDER } from '../llm/llm.types';
import { MemoryService } from '../memory/memory.service';
import { scopeForDeviceTarget } from '../permissions/permission.types';
import { PermissionsService } from '../permissions/permissions.service';
import { SkillRegistry } from '../skills/skill.registry';
import { OrchestratorEmitter } from './orchestrator.events';
import { JARVIS_SYSTEM_PROMPT } from './personality';
import { buildLanguageHint } from './language.util';

const MAX_TOOL_ITERATIONS = 8;

const REMEMBER_FACT_TOOL: ToolDefinition = {
  name: 'remember_fact',
  description: 'Store a lasting fact or preference about the user in long-term memory.',
  parameters: {
    type: 'object',
    properties: {
      fact: { type: 'string', description: 'The fact to remember, phrased as a full sentence.' },
    },
    required: ['fact'],
  },
};

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly skills: SkillRegistry,
    private readonly memory: MemoryService,
    private readonly guardrails: GuardrailService,
    private readonly permissions: PermissionsService,
  ) {}

  get providerName(): string {
    return this.llm.name;
  }

  killSwitch(conversationId?: string): number {
    const targets = conversationId
      ? [this.activeRuns.get(conversationId)].filter(Boolean)
      : [...this.activeRuns.values()];
    for (const controller of targets) {
      controller?.abort();
    }
    this.logger.warn(`Kill switch triggered (${targets.length} run(s) aborted).`);
    return targets.length;
  }

  activeRunCount(): number {
    return this.activeRuns.size;
  }

  async handleUserMessage(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger = 'chat',
    clientPlatform: 'desktop' | 'web' = 'desktop',
  ): Promise<void> {
    const abort = new AbortController();
    this.activeRuns.set(conversationId, abort);

    try {
      await this.memory.appendMessage(conversationId, 'user', userText);

      const facts = await this.memory.recallFacts(userText);
      const now = new Date().toLocaleString('en-GB', {
        dateStyle: 'full',
        timeStyle: 'short',
      });
      let systemPrompt = `${JARVIS_SYSTEM_PROMPT}\n\nCurrent date and time: ${now}. Use this when interpreting relative dates like "tomorrow" or "next week".`;
      systemPrompt += buildLanguageHint(userText);
      if (facts.length) {
        systemPrompt += `\n\nKnown facts about the user:\n${facts.map((f) => `- ${f}`).join('\n')}`;
      }

      const { messages: history, truncated } = await this.memory.loadConversation(conversationId);
      if (truncated > 0) {
        systemPrompt += `\n\nNote: ${truncated} older message(s) exist in permanent storage. Episodic log and facts below may cover earlier context.`;
        const olderEvents = await this.memory.recentEvents(15);
        if (olderEvents.length) {
          systemPrompt += `\n\nRecent activity log:\n${olderEvents.map((e) => `- [${e.createdAt.toISOString()}] ${e.summary}`).join('\n')}`;
        }
      }
      systemPrompt += `\n\nConversation history uses [date, time] prefixes — use them to recall when topics were discussed.`;

      const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history];
      const tools = [...this.skills.toolDefinitions(), REMEMBER_FACT_TOOL];

      let finalText = '';
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const result = await this.llm.chat({
          messages,
          tools,
          signal: abort.signal,
          onToken: (token) => emitter.onToken(token),
        });

        if (!result.toolCalls.length) {
          finalText = result.content;
          break;
        }

        messages.push({
          role: 'assistant',
          content: result.content,
          toolCalls: result.toolCalls,
        });

        for (const call of result.toolCalls) {
          const output = await this.executeToolCall(conversationId, call, emitter, trigger, clientPlatform);
          messages.push({
            role: 'tool',
            content: output,
            toolCallId: call.id,
            toolName: call.name,
          });
        }
      }

      if (finalText) {
        await this.memory.appendMessage(conversationId, 'assistant', finalText);
      }
      await this.memory.logEvent(trigger, `Handled: ${userText.slice(0, 120)}`);
      emitter.onDone(finalText);
    } catch (error) {
      const message = abort.signal.aborted
        ? 'Action halted by kill switch.'
        : (error as Error).message;
      this.logger.error(`Run failed: ${message}`);
      await this.guardrails.audit('run_error', trigger, message, 'error');
      emitter.onError(message);
    } finally {
      this.activeRuns.delete(conversationId);
    }
  }

  private async executeToolCall(
    conversationId: string,
    call: ToolCall,
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<string> {
    emitter.onToolStart(call.name, call.arguments);

    if (call.name === REMEMBER_FACT_TOOL.name) {
      const fact = String(call.arguments?.fact ?? '');
      await this.memory.rememberFact(fact);
      await this.guardrails.audit(call.name, trigger, fact, 'success');
      emitter.onToolEnd(call.name, 'Fact stored.', true);
      return 'Fact stored in long-term memory.';
    }

    const skill = this.skills.get(call.name);
    if (!skill) {
      emitter.onToolEnd(call.name, 'Unknown skill.', false);
      return `Error: unknown skill "${call.name}".`;
    }

    if (skill.name === 'device_control') {
      const target = String(call.arguments?.target ?? '');
      const scope = scopeForDeviceTarget(target);
      const platform = clientPlatform;
      if (scope && !(await this.permissions.isGranted(scope, platform))) {
        const approved = await this.permissions.requestGrant(
          conversationId,
          scope,
          platform,
          (request) => emitter.onPermissionRequest(request),
        );
        if (!approved) {
          await this.guardrails.audit(skill.name, trigger, JSON.stringify(call.arguments), 'permission_denied');
          emitter.onToolEnd(call.name, 'Permission denied by user.', false);
          return 'The user denied device control permission. Do not retry without user consent.';
        }
      }
    }

    if (this.skillNeedsConfirmation(skill, call.arguments)) {
      const approved = await this.guardrails.requestConfirmation(
        conversationId,
        skill.name,
        call.arguments,
        (request) => emitter.onConfirmationRequest(request),
      );
      if (!approved) {
        await this.guardrails.audit(skill.name, trigger, JSON.stringify(call.arguments), 'rejected');
        emitter.onToolEnd(call.name, 'Rejected by user.', false);
        return 'The user rejected this action. Do not retry it.';
      }
    }

    const execArgs =
      skill.name === 'device_control'
        ? { ...call.arguments, platform: clientPlatform }
        : call.arguments;
    const result = await skill.execute(execArgs, { conversationId });
    await this.guardrails.audit(
      skill.name,
      trigger,
      JSON.stringify(call.arguments),
      result.success ? 'success' : 'failure',
    );
    emitter.onToolEnd(call.name, result.output, result.success);
    return result.output;
  }

  private skillNeedsConfirmation(
    skill: { name: string; requiresConfirmation: boolean },
    args: Record<string, unknown>,
  ): boolean {
    if (skill.requiresConfirmation) {
      return true;
    }
    if (skill.name === 'manage_calendar') {
      const action = String(args?.action ?? '');
      return action === 'delete' || action === 'move';
    }
    return false;
  }
}
