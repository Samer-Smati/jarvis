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
import {
  buildLanguageHint,
  buildToolResultLanguageReminder,
  resolveLanguageMode,
} from './language.util';
import { ClientHistoryMessage, mergeClientHistory } from './client-history.util';
import { isFastChatTurn, isConcreteSelfImproveRequest, isSelfImproveInfoQuery, isServerlessRuntime } from './fast-chat.util';

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
    clientHistory?: ClientHistoryMessage[],
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
      const { messages: dbHistory, truncated } = await this.memory.loadConversation(conversationId);
      const history = mergeClientHistory(dbHistory, clientHistory, userText);
      const recentUserTexts = history
        .filter((m) => m.role === 'user')
        .slice(-5)
        .map((m) => String(m.content ?? '').replace(/^\[[^\]]+\]\s*/, ''));
      const languageMode = resolveLanguageMode(userText, recentUserTexts);

      let systemPrompt = `${JARVIS_SYSTEM_PROMPT}\n\nCurrent date and time: ${now}. Use this when interpreting relative dates like "tomorrow" or "next week".`;
      systemPrompt += buildLanguageHint(userText, recentUserTexts);
      if (facts.length) {
        systemPrompt += `\n\nKnown facts about the user:\n${facts.map((f) => `- ${f}`).join('\n')}`;
      }

      if (truncated > 0) {
        systemPrompt += `\n\nNote: ${truncated} older message(s) exist in permanent storage. Episodic log and facts below may cover earlier context.`;
        const olderEvents = await this.memory.recentEvents(15);
        if (olderEvents.length) {
          systemPrompt += `\n\nRecent activity log:\n${olderEvents.map((e) => `- [${e.createdAt.toISOString()}] ${e.summary}`).join('\n')}`;
        }
      }
      systemPrompt += `\n\nConversation history uses [date, time] prefixes — use them to recall when topics were discussed.`;
      if (isFastChatTurn(userText)) {
        systemPrompt += `\n\nThis is a brief greeting or acknowledgment — reply in one short spoken sentence. Do not call any tools.`;
      }
      if (isSelfImproveInfoQuery(userText)) {
        systemPrompt += `\n\nThe user is asking what you CAN upgrade — call self_improve with action=status ONCE, then answer in plain language from that output. Do NOT call inspect, write, commit, or pull_request in this turn. Offer 2–3 concrete upgrade ideas (UI, skills, voice, speed) and wait for their pick.`;
      }
      if (isConcreteSelfImproveRequest(userText)) {
        systemPrompt += `\n\nThe user wants a REAL code upgrade. GitHub reads/writes are available on cloud via self_improve — do NOT use read_files or coding_assistant. Workflow: inspect with paths ["frontend/src/app/chat/chat.component.html","frontend/src/app/chat/chat.component.scss"] OR one file path → write full updated content → pull_request. Never say sandbox is unmounted or ask the user to paste files. Screenshots are unavailable — use responsive CSS instead.`;
      }

      const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history];
      const fastTurn = isServerlessRuntime() && isFastChatTurn(userText);
      const tools = fastTurn ? [] : [...this.skills.toolDefinitions(), REMEMBER_FACT_TOOL];

      let finalText = '';
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        if (iteration > 0) {
          emitter.onProgress?.({
            stage: 'reply',
            message: 'Preparing your answer…',
            percent: Math.min(40 + iteration * 8, 88),
          });
        }
        let streamedContent = '';
        const result = await this.llm.chat({
          messages,
          tools,
          signal: abort.signal,
          onToken: (token) => {
            streamedContent += token;
            emitter.onToken(token);
          },
          onThinking: (token) => emitter.onThinking?.(token),
        });

        if (!result.toolCalls.length) {
          finalText = (result.content || streamedContent).trim();
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
            content: output + buildToolResultLanguageReminder(languageMode),
            toolCallId: call.id,
            toolName: call.name,
          });
        }
      }

      if (finalText) {
        await this.memory.appendMessage(conversationId, 'assistant', finalText);
      }
      void this.memory.logEvent(trigger, `Handled: ${userText.slice(0, 120)}`);
      emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
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

    if (call.name === 'self_improve') {
      const action = String(call.arguments?.action ?? '');
      emitter.onProgress?.({
        stage: action || 'self_improve',
        message: selfImproveProgressLabel(action, call.arguments),
        percent: selfImproveProgressPercent(action),
        detail: typeof call.arguments?.path === 'string' ? call.arguments.path : undefined,
        toolName: 'self_improve',
      });
    }

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
    const result = await skill.execute(execArgs, {
      conversationId,
      onProgress: (event) =>
        emitter.onProgress?.({
          ...event,
          toolName: skill.name,
        }),
    });
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
    if (skill.name === 'self_improve') {
      const action = String(args?.action ?? '');
      return action === 'write' || action === 'commit' || action === 'pull_request';
    }
    return false;
  }
}

function selfImproveProgressPercent(action: string): number {
  switch (action) {
    case 'status':
      return 12;
    case 'inspect':
      return 28;
    case 'write':
      return 52;
    case 'run_checks':
      return 72;
    case 'commit':
      return 86;
    case 'pull_request':
      return 96;
    default:
      return 20;
  }
}

function selfImproveProgressLabel(action: string, args: Record<string, unknown>): string {
  const path = typeof args?.path === 'string' ? args.path : '';
  switch (action) {
    case 'status':
      return 'Checking upgrade status';
    case 'inspect':
      return path ? `Inspecting ${path}` : 'Inspecting project';
    case 'write':
      return path ? `Writing ${path}` : 'Writing changes';
    case 'run_checks':
      return 'Running build checks';
    case 'commit':
      return 'Committing changes';
    case 'pull_request':
      return 'Opening pull request';
    default:
      return 'Self-upgrade in progress';
  }
}
