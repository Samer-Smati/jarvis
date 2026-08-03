import { Inject, Injectable, Logger } from '@nestjs/common';
import { BrainService } from '../brain/brain.service';
import { BrainOpsPauseService } from '../brain/brain-ops-pause.service';
import { GuardrailService } from '../guardrails/guardrail.service';
import type { ChatMessage, LlmProvider, ToolCall, ToolDefinition, ChatImagePart } from '../llm/llm.types';
import { LLM_PROVIDER } from '../llm/llm.types';
import { LlmService } from '../llm/llm.service';
import { TaskRouterService } from '../llm/task-router.service';
import { sanitizeUserFacingAssistantText, ToolMarkupStreamFilter } from '../llm/text-tool-call.util';
import { MemoryService } from '../memory/memory.service';
import { FeedbackService } from '../feedback/feedback.service';
import { LessonsService } from '../lessons/lessons.service';
import { scopeForDeviceTarget } from '../permissions/permission.types';
import { PermissionsService } from '../permissions/permissions.service';
import { SkillRegistry } from '../skills/skill.registry';
import { isSkillAllowedOnRuntime, missingEnvForSkill, runtimeProfile, permissionForSkill, maxSkillTier, isTierGranted, tierDenialMessage, runtimeDenialMessage } from '../skills/permissions';
import { emitTurnStatus, OrchestratorEmitter } from './orchestrator.events';
import { toolStatusLabel } from './tool-status-label.util';
import {
  buildSuccessfulToolReply,
  buildToolFailureReply,
  EMPTY_TURN_FALLBACK,
  isToolFailureOutput,
} from './tool-failure.util';
import {
  applyPrClaimGuard,
  buildPrGuardRetrySystemPrompt,
  ToolTurnRecord,
} from './pr-claim-guard.util';
import { normalizeSelfImproveArgs } from '../skills/self-improve-args.util';
import { PersonalityService } from './personality.service';
import {
  buildLanguageHint,
  buildToolResultLanguageReminder,
  resolveLanguageMode,
} from './language.util';
import { ClientHistoryMessage, mergeClientHistory } from './client-history.util';
import {
  extractAlsoBrainFlag,
  extractRememberFactText,
  formatRememberFactReply,
  resolvePreferenceWrites,
} from './remember-fact.util';
import { isFastChatTurn, isBrainGraphRequest, isBrainConsolidateRequest, isBrainCleanupRequest, isBrainPlanOnlyRequest, isBrainOpsMetaQuestion, isBrainOpsPauseRequest, isBrainOpsResumeRequest, isBrainMutatingAction, BRAIN_OPS_BLOCKED_MESSAGE, isConcreteSelfImproveRequest, isResponsiveUpgradeRequest, isSelfImproveInfoQuery, isSelfImproveSkillSourceRequest, isServerlessRuntime, isUrlIngestTurn, extractUrls, isSaveToBrainRequest, isExplicitLessonRequest, extractExplicitLessonText, isAboutUserQuery, buildAboutUserReply, isLinkProfileRequest, isShowBrainPageRequest, isAffirmativeLinkProfile, shouldSkipBrainLearning, isWeatherRequest, extractWeatherLocation, requiresWebSearch, extractWebSearchQuery, isWebSearchMetaQuestion, isCodeArchitectureQuestion, isPlanOnlyRequest, prefersStructuredMemoryOverBrain } from './fast-chat.util';
import {
  buildWebSearchUnavailableMessage,
  isFailedWebSearchOutput,
} from '../skills/impl/web-search.util';

const MAX_TOOL_ITERATIONS = 8;
const SERVERLESS_MAX_TOOL_ITERATIONS = 6;
const SERVERLESS_DEADLINE_MS = 285_000;

const REMEMBER_FACT_TOOL: ToolDefinition = {
  name: 'remember_fact',
  description:
    'Store a lasting fact or preference about the user. For identity fields (name, role, employer, industry, region) pass key=user.name (etc.) or a preferences map — those write user_preferences rows. Does NOT write the brain vault unless also_brain=true.',
  parameters: {
    type: 'object',
    properties: {
      fact: { type: 'string', description: 'The fact or preference value, phrased clearly.' },
      text: { type: 'string', description: 'Alias for fact if the model uses text instead.' },
      key: {
        type: 'string',
        description:
          'Optional preference key (e.g. user.name, user.role, user.former_employer, user.industry, user.region).',
      },
      preferences: {
        type: 'object',
        description:
          'Optional map of preference keys to values for structured user_preferences writes in one call.',
      },
      also_brain: {
        type: 'boolean',
        description: 'If true, also duplicate into the brain vault wiki. Default false.',
      },
    },
    required: ['fact'],
  },
};

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly activeRuns = new Map<string, { controller: AbortController; requestId: string }>();

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly llmService: LlmService,
    private readonly taskRouter: TaskRouterService,
    private readonly skills: SkillRegistry,
    private readonly memory: MemoryService,
    private readonly brain: BrainService,
    private readonly brainOpsPause: BrainOpsPauseService,
    private readonly guardrails: GuardrailService,
    private readonly permissions: PermissionsService,
    private readonly personality: PersonalityService,
    private readonly feedback: FeedbackService,
    private readonly lessons: LessonsService,
  ) {}

  get providerName(): string {
    return this.llm.name;
  }

  killSwitch(conversationId?: string): number {
    const targets = conversationId
      ? [this.activeRuns.get(conversationId)].filter(Boolean)
      : [...this.activeRuns.values()];
    for (const entry of targets) {
      entry?.controller.abort();
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
    images?: ChatImagePart[],
    requestId?: string,
  ): Promise<void> {
    const runRequestId = requestId?.trim() || conversationId;
    const previous = this.activeRuns.get(conversationId);
    if (previous) {
      previous.controller.abort();
    }
    const abort = new AbortController();
    this.activeRuns.set(conversationId, { controller: abort, requestId: runRequestId });
    const turnStarted = Date.now();
    const toolsUsed: string[] = [];
    const toolRecords: ToolTurnRecord[] = [];
    let prGuardRetried = false;

    try {
      emitTurnStatus(emitter, { stage: 'accepted', message: 'Request received, sir…' });

      const storedText =
        images?.length && !userText.trim()
          ? `[${images.length} image(s) attached]`
          : images?.length
            ? `${userText.trim()} [${images.length} image(s) attached]`
            : userText;
      await this.memory.appendMessage(conversationId, 'user', storedText);

      const { messages: dbHistory, truncated } = await this.memory.loadConversation(conversationId);
      const history = mergeClientHistory(dbHistory, clientHistory, userText);
      const recentContext = history
        .slice(-8)
        .map((m) => String(m.content ?? ''))
        .join('\n');

      if (isResponsiveUpgradeRequest(userText) && !images?.length) {
        const handled = await this.runResponsivePresetUpgrade(
          conversationId,
          userText,
          emitter,
          trigger,
          clientPlatform,
        );
        if (handled) {
          return;
        }
      }

      if (isWeatherRequest(userText) && !images?.length) {
        const handled = await this.runWeatherLookup(
          conversationId,
          userText,
          emitter,
          trigger,
          clientPlatform,
        );
        if (handled) {
          return;
        }
      }

      if (isWebSearchMetaQuestion(userText) && !images?.length) {
        const handled = await this.runWebSearchMetaAnswer(
          conversationId,
          userText,
          emitter,
          trigger,
        );
        if (handled) {
          return;
        }
      }

      if (requiresWebSearch(userText) && !images?.length) {
        const handled = await this.runWebSearchLookup(
          conversationId,
          userText,
          emitter,
          trigger,
          clientPlatform,
        );
        if (handled) {
          return;
        }
      }

      if (isBrainOpsMetaQuestion(userText) && !images?.length) {
        const handled = await this.runBrainOpsMetaAnswer(conversationId, userText, emitter, trigger);
        if (handled) {
          return;
        }
      }

      if (isBrainOpsPauseRequest(userText) && !images?.length) {
        const handled = await this.runBrainOpsPause(conversationId, userText, emitter, trigger);
        if (handled) {
          return;
        }
      }

      if (isBrainOpsResumeRequest(userText) && !images?.length) {
        const handled = await this.runBrainOpsResume(conversationId, userText, emitter, trigger);
        if (handled) {
          return;
        }
      }

      const brainOpsPaused = await this.brainOpsPause.isPaused();

      if (!brainOpsPaused && !isBrainPlanOnlyRequest(userText) && isBrainCleanupRequest(userText)) {
        const handled = await this.runBrainCleanup(
          conversationId,
          userText,
          emitter,
          trigger,
          clientPlatform,
        );
        if (handled) {
          return;
        }
      }

      if (!brainOpsPaused && !isBrainPlanOnlyRequest(userText) && isBrainConsolidateRequest(userText)) {
        const handled = await this.runBrainConsolidate(
          conversationId,
          userText,
          emitter,
          trigger,
          clientPlatform,
        );
        if (handled) {
          return;
        }
      }

      if (isBrainGraphRequest(userText)) {
        const handled = await this.runBrainGraphOpen(
          conversationId,
          userText,
          emitter,
          trigger,
          clientPlatform,
        );
        if (handled) {
          return;
        }
      }

      if (isUrlIngestTurn(userText)) {
        const handled = await this.runUrlIngest(conversationId, userText, emitter, trigger, clientPlatform);
        if (handled) {
          return;
        }
      }

      if (isExplicitLessonRequest(userText) && !images?.length) {
        const handled = await this.runExplicitLessonSave(conversationId, userText, history, emitter, trigger);
        if (handled) {
          return;
        }
      }

      if (isSaveToBrainRequest(userText)) {
        const handled = await this.runSaveToBrain(conversationId, userText, history, emitter, trigger, clientPlatform);
        if (handled) {
          return;
        }
      }

      if (isAboutUserQuery(userText)) {
        const handled = await this.runAboutUser(conversationId, userText, emitter, trigger);
        if (handled) {
          return;
        }
      }

      if (isLinkProfileRequest(userText) || isAffirmativeLinkProfile(userText, recentContext)) {
        const handled = await this.runLinkProfileToJarvis(
          conversationId,
          userText,
          emitter,
          trigger,
          clientPlatform,
        );
        if (handled) {
          return;
        }
      }

      if (isShowBrainPageRequest(userText)) {
        const handled = await this.runShowBrainPage(conversationId, userText, emitter, trigger);
        if (handled) {
          return;
        }
      }

      const contextChars =
        history.reduce((sum, m) => sum + String(m.content ?? '').length, 0) + userText.length;
      const taskRoute = this.taskRouter.resolve(userText, images, contextChars);
      const routeLabel = taskRoute.route.model
        ? `${taskRoute.route.provider}/${taskRoute.route.model}`
        : taskRoute.route.provider;
      emitTurnStatus(emitter, {
        stage: 'routing',
        message: `Routing to ${taskRoute.task} (${routeLabel})…`,
      });

      const memoryContextPromise = this.memory.buildContext(userText, taskRoute.task);
      const brainContextPromise = this.brain.getContextBlock(userText);
      const [memoryContext, brainContext] = await Promise.all([
        memoryContextPromise,
        brainContextPromise,
      ]);
      if (memoryContext.lessonIds?.length) {
        void this.lessons.recordRetrieval(memoryContext.lessonIds);
      }
      const facts = memoryContext.facts;
      const now = new Date().toLocaleString('en-GB', {
        dateStyle: 'full',
        timeStyle: 'short',
      });
      const recentUserTexts = history
        .filter((m) => m.role === 'user')
        .slice(-5)
        .map((m) => String(m.content ?? '').replace(/^\[[^\]]+\]\s*/, ''));
      const languageMode = resolveLanguageMode(userText, recentUserTexts);

      let systemPrompt = `${this.personality.getActivePrompt()}\n\nCurrent date and time: ${now}. Use this when interpreting relative dates like "tomorrow" or "next week".`;
      systemPrompt += buildLanguageHint(userText, recentUserTexts);
      if (facts.length) {
        systemPrompt += `\n\nKnown facts about the user:\n${facts.map((f) => `- ${f}`).join('\n')}`;
      }
      if (memoryContext.preferences.length) {
        systemPrompt += `\n\nUser preferences:\n${memoryContext.preferences.map((p) => `- ${p}`).join('\n')}`;
      }
      if (memoryContext.projects.length) {
        systemPrompt += `\n\nActive projects:\n${memoryContext.projects.map((p) => `- ${p}`).join('\n')}`;
      }
      if (memoryContext.conversationHits.length) {
        systemPrompt += `\n\nRelevant past conversations:\n${memoryContext.conversationHits.map((h) => `- ${h}`).join('\n')}`;
      }
      if (memoryContext.lessons?.length) {
        systemPrompt += `\n\nThings I've learned:\n${memoryContext.lessons.map((l) => `- ${l}`).join('\n')}`;
      }
      if (brainContext.trim()) {
        systemPrompt += `\n\nJARVIS Brain (persistent wiki — hot cache + linked pages, claude-obsidian pattern):\n${brainContext}`;
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
      if (isConcreteSelfImproveRequest(userText) && !isResponsiveUpgradeRequest(userText)) {
        const planOnly = isPlanOnlyRequest(userText) || isCodeArchitectureQuestion(userText);
        systemPrompt += planOnly
          ? `\n\nThe user wants architecture/plan honesty from inspected files — call self_improve inspect on cited paths. Do NOT write or open a pull_request until they explicitly say to proceed.`
          : `\n\nThe user wants a REAL code upgrade on cloud. Use at most: one inspect with paths for needed files → one write (prefer small targeted edits, not rewriting entire large files) → pull_request. Skip redundant inspects and status calls. After pull_request succeeds, stop — do not call more tools. Never merge unless the user explicitly asks. Never say sandbox is unmounted.`;
      }
      if (isResponsiveUpgradeRequest(userText)) {
        systemPrompt += `\n\nThe user wants responsive/mobile UI. Prefer self_improve action=apply_preset preset=responsive_chat then pull_request on the same branch. Do NOT read entire SCSS files first.`;
      }
      if (isBrainPlanOnlyRequest(userText)) {
        systemPrompt +=
          `\n\nThe user wants a PLAN or recommendations about the brain/wiki — do NOT call brain cleanup, consolidate, or graph this turn. ` +
          `Do NOT repeat prior fast-path confirmation messages verbatim (e.g. "Relational mapping complete…"). ` +
          `Call brain action=status or action=query if you need live page/link counts, then propose steps only.`;
      }
      if (await this.brainOpsPause.isPaused()) {
        systemPrompt +=
          `\n\nBrain operations are PAUSED — do NOT call brain cleanup, consolidate, or rehydrate. ` +
          `You may still use brain status, query, graph (read-only), remember, and ingest. ` +
          `If the user asks to run mutating brain ops, explain they are paused and suggest resume via Settings or "resume brain operations".`;
      }
      if (isBrainGraphRequest(userText) && !isBrainPlanOnlyRequest(userText)) {
        systemPrompt += `\n\nThe user wants to SEE the brain link graph. Call brain with action=graph ONCE — that opens the live graph UI. Briefly describe node/link counts from the tool output. Do not only describe links in prose.`;
      }
      if (isBrainConsolidateRequest(userText) && !isBrainPlanOnlyRequest(userText)) {
        systemPrompt += `\n\nThe user wants brain pages LINKED for real. Call brain action=consolidate ONCE (writes [[wiki]] edges), then briefly report how many new links were created from the tool output. Do not only describe linking in prose.`;
      }
      if (isSelfImproveSkillSourceRequest(userText)) {
        systemPrompt += `\n\nThe user wants to upgrade the self_improve SKILL SOURCE FILE. It IS in the repo at backend/src/skills/impl/self-improve.skill.ts — NOT a hidden runtime tool. Workflow: self_improve inspect path=backend/src/skills/impl/self-improve.skill.ts mode=read → write that path → pull_request. Do NOT inspect "." or scripts/ instead. NEVER say the skill is built-in or unmodifiable.`;
      }
      if (isCodeArchitectureQuestion(userText)) {
        systemPrompt +=
          `\n\nThis turn asks how repo code, skills, schedulers, or PR deploys work. ` +
          `You MUST call self_improve inspect on every file path you cite BEFORE describing contents. ` +
          `Paste verbatim lines from inspect when quoting code — never fabricate module definitions or imports. ` +
          `Vercel/serverless: scheduleModules is empty in app.module.ts — @Cron does not run on production. ` +
          `New skills need skills.module.ts; entities under skills/entities/. No skill.yaml or backend/src/shared/.`;
        if (isPlanOnlyRequest(userText)) {
          systemPrompt += ` The user asked for plan/answers only — do NOT call self_improve write or pull_request this turn.`;
        }
      }
      if (requiresWebSearch(userText)) {
        systemPrompt += `\n\nThis turn REQUIRES live web data. You MUST call web_search with a focused query before answering. Do not answer from training data or memory alone — search first, then synthesize from results with source links.`;
      }
      const urls = extractUrls(userText);
      if (prefersStructuredMemoryOverBrain(userText)) {
        systemPrompt += `\n\nThe user wants STRUCTURED long-term memory via remember_fact (writes semantic_memories / user_preferences). Do NOT call brain, ingest_url, or graph this turn unless they also explicitly ask to open the graph. Call remember_fact once per lasting fact/preference.`;
      } else if (urls.length && !isUrlIngestTurn(userText)) {
        systemPrompt += `\n\nThe user mentioned a URL (${urls[0]}). You CAN fetch it with brain action=ingest_url. Never refuse link access.`;
      }
      if (images?.length) {
        systemPrompt += `\n\nThe user attached ${images.length} image(s) this turn. Describe what you see in the image(s) and answer their question.`;
      }

      systemPrompt += `\n\nLLM route: ${taskRoute.task} (${taskRoute.reason}).`;
      if (taskRoute.userNotice) {
        systemPrompt += `\n\nBriefly mention to the user (one short sentence): ${taskRoute.userNotice}`;
      }

      const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history];
      if (images?.length) {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            messages[i] = {
              ...messages[i],
              content: userText.trim() || 'Please look at the attached image(s).',
              images,
            };
            break;
          }
        }
      }
      const fastTurn = isServerlessRuntime() && isFastChatTurn(userText) && !images?.length;
      const tools = fastTurn ? [] : [...this.skills.toolDefinitions(), REMEMBER_FACT_TOOL];

      let finalText = '';
      let lastToolOutput = '';
      let emptyProseRetried = false;
      const toolFailures: Array<{ toolName: string; output: string }> = [];
      const deadline = isServerlessRuntime() ? Date.now() + SERVERLESS_DEADLINE_MS : Infinity;
      const maxIterations = isServerlessRuntime() ? SERVERLESS_MAX_TOOL_ITERATIONS : MAX_TOOL_ITERATIONS;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (this.isSuperseded(conversationId, runRequestId, abort)) {
          emitter.onDone('', { superseded: true });
          return;
        }
        const prDone = lastToolOutput.includes('Pull request #');
        if (prDone) {
          finalText = finalText || `Done, sir. ${lastToolOutput.split('\n')[0]}`;
          break;
        }

        const nearDeadline = isServerlessRuntime() && Date.now() > deadline - 5_000;
        if (nearDeadline) {
          finalText =
            finalText ||
            (lastToolOutput
              ? `Cloud time limit reached, sir. Last step: ${lastToolOutput.slice(0, 280)}`
              : 'Cloud time limit reached before I could finish, sir. Please try again.');
          break;
        }

        if (iteration === 0) {
          emitTurnStatus(emitter, { stage: 'thinking', message: 'Thinking…' });
        } else {
          emitTurnStatus(emitter, {
            stage: 'thinking',
            message: 'Preparing your answer…',
            percent: Math.min(40 + iteration * 8, 88),
          });
        }
        let streamedContent = '';
        let writingEmitted = false;
        const tokenFilter = new ToolMarkupStreamFilter();
        const turnTools = emptyProseRetried ? [] : tools;
        const result = await this.llmService.chatWithRoute(userText, {
          messages,
          tools: turnTools,
          signal: abort.signal,
          route: taskRoute.route,
          onToken: (token) => {
            tokenFilter.feed(token, (safe) => {
              streamedContent += safe;
              if (safe) {
                if (!writingEmitted) {
                  writingEmitted = true;
                  emitTurnStatus(emitter, { stage: 'writing', message: 'Writing response…' });
                }
                emitter.onToken(safe);
              }
            });
          },
          onThinking: (token) => emitter.onThinking?.(token),
        });
        this.taskRouter.recordUsage(
          estimateTurnTokens(messages, result.content),
        );

        if (!result.toolCalls.length) {
          if (requiresWebSearch(userText) && !toolsUsed.includes('web_search')) {
            const query = extractWebSearchQuery(userText);
            emitter.onProgress?.({
              stage: 'web_search',
              message: 'Searching the web (required)…',
              percent: Math.min(35 + iteration * 8, 80),
              toolName: 'web_search',
            });
            toolsUsed.push('web_search');
            const searchOutput = await this.executeToolCall(
              conversationId,
              { id: `web-search-required-${iteration}`, name: 'web_search', arguments: { query } },
              emitter,
              trigger,
              clientPlatform,
            );
            if (isFailedWebSearchOutput(searchOutput)) {
              finalText = buildWebSearchUnavailableMessage(searchOutput);
              break;
            }
            messages.push({
              role: 'assistant',
              content: result.content || 'Searching the web for current information…',
              toolCalls: [
                {
                  id: `web-search-required-${iteration}`,
                  name: 'web_search',
                  arguments: { query },
                },
              ],
            });
            messages.push({
              role: 'tool',
              content: searchOutput + buildToolResultLanguageReminder(languageMode),
              toolCallId: `web-search-required-${iteration}`,
              toolName: 'web_search',
            });
            lastToolOutput = searchOutput;
            continue;
          }
          if (
            requiresWebSearch(userText) &&
            toolsUsed.includes('web_search') &&
            isFailedWebSearchOutput(lastToolOutput)
          ) {
            finalText = buildWebSearchUnavailableMessage(lastToolOutput);
            break;
          }
          const proseCandidate = sanitizeUserFacingAssistantText((result.content || streamedContent).trim());
          if (!proseCandidate && !toolsUsed.length && !emptyProseRetried) {
            emptyProseRetried = true;
            messages.push({
              role: 'user',
              content:
                'Your previous response was empty. Answer the user now in one to three short spoken sentences. Do not call tools.',
            });
            continue;
          }
          const guarded = this.resolveFinalTextWithPrGuard(
            userText,
            proseCandidate,
            toolRecords,
            messages,
            tools,
            prGuardRetried,
          );
          if (guarded.retry) {
            prGuardRetried = true;
            continue;
          }
          finalText = guarded.finalText;
          break;
        }

        messages.push({
          role: 'assistant',
          content: result.content,
          toolCalls: result.toolCalls,
        });

        for (const call of result.toolCalls) {
          toolsUsed.push(call.name);
          const output = await this.executeToolCall(conversationId, call, emitter, trigger, clientPlatform);
          lastToolOutput = output;
          toolRecords.push({
            toolName: call.name,
            action: String(call.arguments?.action ?? ''),
            output,
          });
          if (isToolFailureOutput(output)) {
            toolFailures.push({ toolName: call.name, output });
          }
          messages.push({
            role: 'tool',
            content: output + buildToolResultLanguageReminder(languageMode),
            toolCallId: call.id,
            toolName: call.name,
          });
          if (
            isServerlessRuntime() &&
            call.name === 'self_improve' &&
            output.includes('Pull request #')
          ) {
            finalText = `Done, sir. ${output.split('\n')[0]}`;
            break;
          }
        }
        if (finalText) {
          break;
        }
      }

      if (!finalText) {
        if (toolFailures.length) {
          finalText = buildToolFailureReply(toolFailures);
        } else if (lastToolOutput.includes('Updated ')) {
          finalText = `Changes are on GitHub, sir. ${lastToolOutput.split('\n')[0]} Say "open PR" if you need the pull request.`;
        } else {
          finalText = buildSuccessfulToolReply(toolRecords, lastToolOutput) ?? EMPTY_TURN_FALLBACK;
        }
      }

      if (this.isSuperseded(conversationId, runRequestId, abort)) {
        emitter.onDone('', { superseded: true });
        return;
      }

      if (finalText) {
        const postGuard = applyPrClaimGuard({
          userText,
          candidate: finalText,
          toolRecords,
        });
        if (postGuard.blocked) {
          finalText = postGuard.text;
        }
        finalText = sanitizeUserFacingAssistantText(finalText) || EMPTY_TURN_FALLBACK;
        finalText = sanitizeSelfImproveDenial(finalText, userText);
        finalText = sanitizeLinkDenial(finalText, userText);
        finalText = sanitizeBrainDenial(finalText, userText);
        finalText = sanitizeWeatherDenial(finalText, userText);
        if (taskRoute.userNotice && !finalText.includes(taskRoute.userNotice.slice(0, 24))) {
          finalText = `${taskRoute.userNotice} ${finalText}`;
        }
        await this.memory.appendMessage(conversationId, 'assistant', finalText);
        this.persistTurnLearning(userText, finalText);
      }
      void this.memory.logEvent(
        trigger,
        finalText?.trim()
          ? `Handled: ${userText.slice(0, 120)}`
          : `Failed (no response): ${userText.slice(0, 120)}`,
      );
      emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
      await this.finishTurn(conversationId, userText, finalText, emitter, {
        taskRoute: taskRoute.task,
        toolsUsed,
        latencyMs: Date.now() - turnStarted,
      });
    } catch (error) {
      const stillActive = this.activeRuns.get(conversationId);
      if (abort.signal.aborted && stillActive?.requestId !== runRequestId) {
        this.logger.log(`Run superseded for ${conversationId} (${runRequestId})`);
        emitter.onDone('', { superseded: true });
        return;
      }
      const message = abort.signal.aborted
        ? 'Action halted by kill switch.'
        : (error as Error).message;
      this.logger.error(`Run failed: ${message}`);
      await this.guardrails.audit('run_error', trigger, message, 'error');
      emitter.onError(message, { retryable: !abort.signal.aborted });
    } finally {
      const stillActive = this.activeRuns.get(conversationId);
      if (stillActive?.controller === abort) {
        this.activeRuns.delete(conversationId);
      }
    }
  }

  private resolveFinalTextWithPrGuard(
    userText: string,
    candidate: string,
    toolRecords: ToolTurnRecord[],
    messages: ChatMessage[],
    tools: ToolDefinition[],
    prGuardRetried: boolean,
  ): { finalText: string; retry: boolean } {
    const guard = applyPrClaimGuard({ userText, candidate, toolRecords });
    if (!guard.blocked) {
      return { finalText: guard.text, retry: false };
    }
    if (guard.shouldRetryWithTools && !prGuardRetried && tools.length > 0) {
      messages.push({
        role: 'system',
        content: buildPrGuardRetrySystemPrompt(),
      });
      return { finalText: '', retry: true };
    }
    return { finalText: guard.text, retry: false };
  }

  private isSuperseded(conversationId: string, runRequestId: string, abort: AbortController): boolean {
    if (!abort.signal.aborted) {
      return false;
    }
    const stillActive = this.activeRuns.get(conversationId);
    return stillActive?.requestId !== runRequestId;
  }

  private async executeToolCall(
    conversationId: string,
    call: ToolCall,
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<string> {
    if (call.name === 'self_improve') {
      call = {
        ...call,
        arguments: normalizeSelfImproveArgs(call.arguments ?? {}),
      };
    }

    emitter.onToolStart(call.name, call.arguments);

    if (call.name !== 'self_improve') {
      emitTurnStatus(emitter, {
        stage: 'tool',
        message: toolStatusLabel(call.name, call.arguments),
        toolName: call.name,
      });
    }

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
      const fact = extractRememberFactText(call.arguments);
      if (!fact) {
        const msg =
          'Error: remember_fact needs a non-empty fact string (argument "fact"). Nothing was stored.';
        emitter.onToolEnd(call.name, msg, false);
        await this.guardrails.audit(call.name, trigger, JSON.stringify(call.arguments ?? {}), 'failure');
        return msg;
      }
      try {
        const preferenceWrites = resolvePreferenceWrites(call.arguments, fact);
        const alsoBrain = extractAlsoBrainFlag(call.arguments);
        const stored = await this.memory.rememberFactDetailed({
          text: fact,
          preferences: preferenceWrites.length ? preferenceWrites : undefined,
          source: 'remember_fact',
        });
        if (alsoBrain) {
          const brainMsg = await this.brain.remember(fact.slice(0, 80), fact, 'fact');
          const pathMatch = /at\s+(\S+\.md)/i.exec(brainMsg);
          stored.brainPath = pathMatch?.[1] ?? brainMsg;
        }
        const reply = formatRememberFactReply(stored);
        await this.guardrails.audit(call.name, trigger, reply, 'success');
        emitter.onToolEnd(call.name, reply, true);
        return reply;
      } catch (error) {
        const msg = `Error: could not store fact — ${(error as Error).message}`;
        emitter.onToolEnd(call.name, msg, false);
        await this.guardrails.audit(call.name, trigger, msg, 'failure');
        return msg;
      }
    }

    const skill = this.skills.get(call.name);
    if (!skill) {
      emitter.onToolEnd(call.name, 'Unknown skill.', false);
      return `Error: unknown skill "${call.name}".`;
    }

    if (call.name === 'self_improve' && !String(call.arguments?.action ?? '').trim()) {
      const msg =
        'Error: self_improve requires action (e.g. pull_request, write, inspect). The model sent an empty action — please retry.';
      emitter.onToolEnd(call.name, msg, false);
      await this.guardrails.audit(call.name, trigger, JSON.stringify(call.arguments), 'failure');
      return msg;
    }

    const profile = runtimeProfile();
    if (!isSkillAllowedOnRuntime(skill.name, profile)) {
      const msg = runtimeDenialMessage(skill.name, profile);
      emitter.onToolEnd(call.name, msg, false);
      await this.guardrails.audit(call.name, trigger, msg, 'permission_denied');
      return msg;
    }

    const perm = permissionForSkill(skill.name);
    const grantedTier = maxSkillTier();
    if (perm && !isTierGranted(perm.tier, grantedTier)) {
      const msg = tierDenialMessage(skill.name, perm.tier, grantedTier);
      emitter.onToolEnd(call.name, msg, false);
      await this.guardrails.audit(call.name, trigger, msg, 'permission_denied');
      return msg;
    }

    const missingEnv = missingEnvForSkill(skill.name);
    if (missingEnv.length) {
      const msg = `Skill "${skill.name}" is not configured. Missing env: ${missingEnv.join(', ')}.`;
      emitter.onToolEnd(call.name, msg, false);
      return msg;
    }

    if (skill.name === 'device_control') {
      const target = String(call.arguments?.target ?? '');
      const scope = scopeForDeviceTarget(target);
      const platform = clientPlatform;
      if (scope && !(await this.permissions.isGranted(scope, platform))) {
        emitTurnStatus(emitter, {
          stage: 'waiting_user',
          message: 'Waiting for your permission…',
        });
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
      emitTurnStatus(emitter, {
        stage: 'waiting_user',
        message: 'Waiting for your confirmation…',
      });
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

    if (skill.name === 'brain') {
      const action = String(call.arguments?.action ?? '');
      if (isBrainMutatingAction(action)) {
        if (await this.brainOpsPause.isPaused()) {
          const msg = BRAIN_OPS_BLOCKED_MESSAGE;
          emitter.onToolEnd(call.name, msg, false);
          await this.guardrails.audit(call.name, trigger, JSON.stringify(call.arguments), 'permission_denied');
          return msg;
        }
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
    const brainCleanup =
      skill.name === 'brain' && String(call.arguments?.action ?? '') === 'cleanup' && result.success;
    await this.guardrails.audit(
      skill.name,
      trigger,
      brainCleanup
        ? JSON.stringify({
            ...call.arguments,
            outputSnippet: result.output.slice(0, 800),
          })
        : result.success
          ? JSON.stringify(call.arguments)
          : JSON.stringify({
              ...call.arguments,
              error: result.output.slice(0, 800),
            }),
      result.success ? 'success' : 'failure',
    );
    if (!result.success) {
      this.logger.warn(
        `Skill ${skill.name} failed: ${result.output.slice(0, 300)} (args=${JSON.stringify(call.arguments).slice(0, 200)})`,
      );
    }
    emitter.onToolEnd(call.name, result.output, result.success);
    return result.output;
  }

  private async finishTurn(
    conversationId: string,
    userText: string,
    finalText: string,
    emitter: OrchestratorEmitter,
    meta?: { taskRoute?: string; toolsUsed?: string[]; latencyMs?: number },
  ): Promise<void> {
    const text = finalText?.trim() || EMPTY_TURN_FALLBACK;
    const logged = await this.feedback.logInteraction({
      conversationId,
      prompt: userText,
      response: text,
      taskRoute: meta?.taskRoute,
      provider: this.llm.name,
      toolsUsed: meta?.toolsUsed,
      latencyMs: meta?.latencyMs,
    });
    emitter.onDone(text, { interactionId: logged.id, taskRoute: meta?.taskRoute });
  }

  private persistTurnLearning(userText: string, assistantText: string): void {
    if (shouldSkipBrainLearning(userText, assistantText)) {
      return;
    }
    void this.brain.learnFromTurn(userText, assistantText);
    void this.memory.indexConversationTurn(userText, assistantText);
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

  private async runResponsivePresetUpgrade(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<boolean> {
    const skill = this.skills.get('self_improve');
    if (!skill) {
      return false;
    }

    const branch = `jarvis/responsive-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;

    emitter.onProgress?.({
      stage: 'inspect',
      message: 'Verifying responsive UI in repo…',
      percent: 22,
      toolName: 'self_improve',
    });

    const verifyOutput = await this.executeToolCall(
      conversationId,
      {
        id: 'responsive-verify',
        name: 'self_improve',
        arguments: { action: 'verify_responsive' },
      },
      emitter,
      trigger,
      clientPlatform,
    );

    emitter.onProgress?.({
      stage: 'apply_preset',
      message: 'Applying responsive UI preset…',
      percent: 35,
      toolName: 'self_improve',
    });

    const presetOutput = await this.executeToolCall(
      conversationId,
      {
        id: 'responsive-preset',
        name: 'self_improve',
        arguments: {
          action: 'apply_preset',
          preset: 'responsive_chat',
          branch,
          message: 'feat(jarvis): responsive chat and mobile shell',
        },
      },
      emitter,
      trigger,
      clientPlatform,
    );

    if (presetOutput.startsWith('Error:') || presetOutput.includes('requires GITHUB_TOKEN')) {
      return false;
    }

    const alreadyApplied =
      presetOutput.includes('already applied') ||
      presetOutput.includes('Already responsive') ||
      presetOutput.includes('No PR needed');
    if (alreadyApplied && !presetOutput.includes('Updated:')) {
      const checkLines = verifyOutput
        .split('\n')
        .filter((line) => line.trim().startsWith('✓') || line.trim().startsWith('✗'))
        .slice(0, 8)
        .join('\n');
      const finalText = [
        'I checked the repo, sir — responsive chat UI is already in place on main.',
        checkLines ? `\nVerification:\n${checkLines}` : '',
        '\nResize the browser or open on your phone: scrollable messages, sticky composer, and breakpoints at 900px / 600px / 768px.',
      ].join('');
      await this.memory.appendMessage(conversationId, 'assistant', finalText);
      this.persistTurnLearning(userText, finalText);
      emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
      emitter.onDone(finalText);
      return true;
    }

    emitter.onProgress?.({
      stage: 'pull_request',
      message: 'Opening pull request…',
      percent: 88,
      toolName: 'self_improve',
    });

    const prOutput = await this.executeToolCall(
      conversationId,
      {
        id: 'responsive-pr',
        name: 'self_improve',
        arguments: {
          action: 'pull_request',
          branch,
          title: 'Responsive chat and mobile shell',
          message: `Automated responsive UI upgrade for: "${userText.slice(0, 200)}"`,
        },
      },
      emitter,
      trigger,
      clientPlatform,
    );

    const finalText = prOutput.includes('Pull request #')
      ? `Done, sir. ${prOutput.split('\n')[0]} Merge to main and Vercel will redeploy.`
      : prOutput.includes('does not exist') || prOutput.includes('no new commits')
        ? `Responsive UI is already on main, sir — no pull request was needed. ${prOutput.split('\n')[0]}`
        : presetOutput.includes('Updated:')
          ? `Changes are on branch ${branch}, sir. ${presetOutput.split('\n')[0]} Say "open PR" if you need the pull request link.`
          : `Responsive upgrade finished, sir. ${presetOutput.split('\n')[0]}`;

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    this.persistTurnLearning(userText, finalText);
    void this.memory.logEvent(trigger, `Responsive preset: ${userText.slice(0, 120)}`);
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runUrlIngest(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<boolean> {
    const urls = extractUrls(userText);
    const url = urls[0];
    if (!url) {
      return false;
    }

    const skill = this.skills.get('brain');
    if (!skill) {
      return false;
    }

    emitter.onProgress?.({
      stage: 'brain',
      message: 'Fetching link…',
      percent: 38,
      detail: url,
      toolName: 'brain',
    });

    const output = await this.executeToolCall(
      conversationId,
      {
        id: 'url-ingest',
        name: 'brain',
        arguments: { action: 'ingest_url', url },
      },
      emitter,
      trigger,
      clientPlatform,
    );

    if (output.startsWith('Error:') || output.startsWith('Could not fetch')) {
      return false;
    }

    const titleMatch = output.match(/^Title: (.+)$/m);
    const excerptMatch = output.match(/Excerpt:\n([\s\S]+)/);
    const title = titleMatch?.[1]?.trim() ?? 'that page';
    const excerpt = excerptMatch?.[1]?.trim().slice(0, 280) ?? '';
    const isProfile = output.includes('Profile entity saved') || output.includes('BRAIN_GRAPH:');

    if (isProfile) {
      await this.executeToolCall(
        conversationId,
        { id: 'brain-graph-after-ingest', name: 'brain', arguments: { action: 'graph' } },
        emitter,
        trigger,
        clientPlatform,
      );
    }

    const finalText = excerpt
      ? `Done, sir. I read ${title} and filed it in my brain${isProfile ? ', linked to JARVIS' : ''}. In short: ${excerpt}${isProfile ? ' Open the graph to see your profile connected.' : ''}`
      : `Done, sir. I read and saved ${title} in my brain. Ask me about it anytime, or say "show the graph" to see how it links.`;

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    this.persistTurnLearning(userText, finalText);
    void this.memory.logEvent(trigger, `URL ingest: ${url.slice(0, 120)}`);
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runWeatherLookup(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<boolean> {
    const skill = this.skills.get('get_weather');
    if (!skill) {
      return false;
    }

    let location = extractWeatherLocation(userText);
    if (!location) {
      const facts = await this.memory.recallFacts('home city location tunis where user lives');
      const fromFacts = facts
        .join(' ')
        .match(/\b(Tunis|Sfax|Sousse|Paris|London|Berlin|Cairo|Algiers|Marseille)\b/i);
      location = fromFacts?.[1] ?? null;
    }

    if (!location) {
      const finalText =
        'Which city should I check the weather for, sir? Name the place and I will pull live conditions from Open-Meteo.';
      await this.memory.appendMessage(conversationId, 'assistant', finalText);
      emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
      emitter.onDone(finalText);
      return true;
    }

    emitter.onProgress?.({
      stage: 'weather',
      message: `Checking weather for ${location}…`,
      percent: 40,
      toolName: 'get_weather',
    });

    const output = await this.executeToolCall(
      conversationId,
      {
        id: 'weather-lookup',
        name: 'get_weather',
        arguments: { location, days: 3 },
      },
      emitter,
      trigger,
      clientPlatform,
    );

    const finalText = output.startsWith('Error:') || output.includes("couldn't find")
      ? `I couldn't fetch weather for ${location}, sir. ${output.split('\n')[0]}`
      : output.includes('Now in')
        ? output.split('\n').slice(0, 4).join(' ')
        : output;

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    this.persistTurnLearning(userText, finalText);
    void this.memory.logEvent(trigger, `Weather: ${location}`);
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runWebSearchMetaAnswer(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
  ): Promise<boolean> {
    const last = await this.feedback.getLastForConversation(conversationId);
    const recentAudits = await this.guardrails.recentAudit(30);
    const lastSearchAudit = recentAudits.find((row) => row.action === 'web_search');
    const tools = last?.toolsUsed?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    const usedWebSearch = tools.includes('web_search');

    let finalText: string;
    if (usedWebSearch) {
      const outcome = lastSearchAudit?.outcome;
      const outcomeNote =
        outcome === 'success'
          ? 'The search succeeded.'
          : outcome
            ? `Search outcome was: ${outcome}.`
            : '';
      finalText = `Yes, sir — that answer used a live web_search call, not training data alone. ${outcomeNote}`.trim();
    } else if (last) {
      const toolNote = last.toolsUsed?.trim()
        ? `Tools logged for that turn: ${last.toolsUsed}.`
        : 'No tools were logged for that turn.';
      finalText = `No, sir — that answer did not use web_search. It was generated without a live search. ${toolNote}`;
    } else {
      finalText =
        "I don't have a logged prior turn for this conversation, sir — I can't confirm whether the last answer used live web search.";
    }

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    void this.memory.logEvent(trigger, 'Web search meta question answered from interaction log');
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runWebSearchLookup(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<boolean> {
    const skill = this.skills.get('web_search');
    if (!skill) {
      return false;
    }

    const profile = runtimeProfile();
    if (!isSkillAllowedOnRuntime('web_search', profile)) {
      return false;
    }

    const perm = permissionForSkill('web_search');
    const grantedTier = maxSkillTier();
    if (perm && !isTierGranted(perm.tier, grantedTier)) {
      const msg = tierDenialMessage('web_search', perm.tier, grantedTier);
      await this.memory.appendMessage(conversationId, 'assistant', msg);
      emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
      emitter.onDone(msg);
      return true;
    }

    const query = extractWebSearchQuery(userText);
    emitter.onProgress?.({
      stage: 'web_search',
      message: 'Searching the web (required)…',
      percent: 35,
      toolName: 'web_search',
    });

    const searchOutput = await this.executeToolCall(
      conversationId,
      {
        id: 'web-search-required',
        name: 'web_search',
        arguments: { query },
      },
      emitter,
      trigger,
      clientPlatform,
    );

    if (isFailedWebSearchOutput(searchOutput)) {
      const finalText = buildWebSearchUnavailableMessage(searchOutput);
      await this.memory.appendMessage(conversationId, 'assistant', finalText);
      void this.memory.logEvent(trigger, `Web search failed: ${query.slice(0, 80)}`);
      emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
      emitter.onDone(finalText);
      return true;
    }

    const taskRoute = this.taskRouter.resolve(userText, undefined, userText.length);
    const synthesisPrompt =
      `${this.personality.getActivePrompt()}\n\n` +
      `The user asked a question that requires current web information. ` +
      `Answer using ONLY the web search results below — do not rely on training data for factual claims. Cite source links. ` +
      `If results are thin or inconclusive, say so plainly.\n\n` +
      `Web search results:\n${searchOutput}`;

    let streamed = '';
    const synthesisFilter = new ToolMarkupStreamFilter();
    const result = await this.llmService.chatWithRoute(userText, {
      messages: [
        { role: 'system', content: synthesisPrompt },
        { role: 'user', content: userText },
      ],
      tools: [],
      route: taskRoute.route,
      onToken: (token) => {
        synthesisFilter.feed(token, (safe) => {
          streamed += safe;
          if (safe) {
            emitter.onToken(safe);
          }
        });
      },
    });
    this.taskRouter.recordUsage(estimateTurnTokens([{ role: 'user', content: userText }], result.content));

    let finalText = sanitizeUserFacingAssistantText((result.content || streamed).trim());
    if (!finalText || finalText.length < 20) {
      finalText = searchOutput.startsWith('Error:') || searchOutput.includes('Permission denied')
        ? `I couldn't complete the web search, sir. ${searchOutput.split('\n')[0]}`
        : searchOutput;
    }

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    this.persistTurnLearning(userText, finalText);
    void this.memory.logEvent(trigger, `Web search: ${query.slice(0, 80)}`);
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runBrainOpsMetaAnswer(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
  ): Promise<boolean> {
    const recentAudits = await this.guardrails.recentAudit(50);
    const cleanupAudits = recentAudits.filter(
      (row) => row.action === 'brain' && row.detail?.includes('"cleanup"'),
    );
    const history = await this.brain.getCleanupHistory();
    const lastVaultCleanup = history.entries[0];
    const episodic = await this.memory.recentEvents(30);
    const lastEpisodicCleanup = episodic.find((e) => e.kind === 'brain_cleanup');

    const asksDeletionLog =
      /\b(deletion log|audit trail|log exist|what pages were removed|which pages|what was deleted|11 deleted|deleted pages)\b/i.test(
        userText,
      );

    let finalText: string;
    if (asksDeletionLog) {
      const parts: string[] = [
        'No, sir — there is no dedicated per-page deletion table in Postgres. Cleanup runs are logged in audit_log as action=brain with {"action":"cleanup"} only (timestamp, no page list).',
      ];
      if (cleanupAudits.length) {
        const latest = cleanupAudits[0];
        parts.push(
          `Yes, cleanup did run — most recently at ${latest.createdAt.toISOString()} (${cleanupAudits.length} recorded cleanup invocation(s) in audit).`,
        );
      } else {
        parts.push('I do not see a successful brain cleanup in the recent audit log.');
      }
      if (lastVaultCleanup?.removed.length) {
        parts.push(
          `The vault log lists ${lastVaultCleanup.count} page(s) from the last logged cleanup (${lastVaultCleanup.at}): ${lastVaultCleanup.removed.slice(0, 12).join('; ')}${lastVaultCleanup.removed.length > 12 ? '…' : ''}.`,
        );
      } else if (lastVaultCleanup?.count) {
        parts.push(
          `The vault log records ${lastVaultCleanup.count} page(s) removed at ${lastVaultCleanup.at}, but individual titles were not logged for that run (older format).`,
        );
      } else if (lastEpisodicCleanup?.detail?.trim()) {
        parts.push(`Episodic log detail:\n${lastEpisodicCleanup.detail.slice(0, 1200)}`);
      } else {
        parts.push('No per-page removal list is stored for the last cleanup — only counts until the next cleanup runs with the updated logger.');
      }
      finalText = parts.join('\n\n');
    } else {
      finalText =
        'Understood, sir — you are asking about prior brain behavior, not requesting a new cleanup/consolidate/pause. ' +
        (cleanupAudits.length
          ? `Recent audit shows ${cleanupAudits.length} brain cleanup invocation(s); latest at ${cleanupAudits[0].createdAt.toISOString()}. `
          : 'No recent brain cleanup appears in audit. ') +
        'I will answer your question directly without opening the graph or changing brain ops state.';
    }

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    void this.memory.logEvent(trigger, 'Brain ops meta question answered');
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runBrainOpsPause(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
  ): Promise<boolean> {
    await this.brainOpsPause.pause(userText.slice(0, 500));
    const finalText =
      'Understood, sir — brain cleanup, consolidate, and rehydrate are paused until you resume. Use Settings or say "resume brain operations".';
    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    void this.memory.logEvent(trigger, 'Brain ops paused');
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runBrainOpsResume(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
  ): Promise<boolean> {
    await this.brainOpsPause.resume();
    const finalText =
      'Brain operations resumed, sir — cleanup, consolidate, and rehydrate are enabled again.';
    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    void this.memory.logEvent(trigger, 'Brain ops resumed');
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runBrainCleanup(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<boolean> {
    if (await this.brainOpsPause.isPaused()) {
      const finalText = BRAIN_OPS_BLOCKED_MESSAGE;
      await this.memory.appendMessage(conversationId, 'assistant', finalText);
      emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
      emitter.onDone(finalText);
      return true;
    }

    const skill = this.skills.get('brain');
    if (!skill) {
      return false;
    }

    emitter.onProgress?.({ stage: 'brain', message: 'Cleaning up brain vault…', percent: 30, toolName: 'brain' });

    await this.brain.reloadFromStore();

    const output = await this.executeToolCall(
      conversationId,
      { id: 'brain-cleanup', name: 'brain', arguments: { action: 'cleanup' } },
      emitter,
      trigger,
      clientPlatform,
    );

    await this.executeToolCall(
      conversationId,
      { id: 'brain-graph-after-cleanup', name: 'brain', arguments: { action: 'graph' } },
      emitter,
      trigger,
      clientPlatform,
    );

    const stats = await this.brain.getVaultStats();
    const finalText = output.includes('removed')
      ? `Brain cleaned up, sir. ${output.split('\n')[0]} Vault now has ${stats.pageCount} notes and ${stats.edgeCount} links.`
      : `Brain vault is tidy, sir. ${stats.pageCount} notes, ${stats.edgeCount} links.`;

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    const history = await this.brain.getCleanupHistory();
    const lastCleanup = history.entries[0];
    if (lastCleanup?.count) {
      void this.memory.logEvent(
        'brain_cleanup',
        `Removed ${lastCleanup.count} page(s)`,
        lastCleanup.removed.length ? lastCleanup.removed.join('\n') : undefined,
      );
    } else {
      void this.memory.logEvent(trigger, 'Brain cleanup');
    }
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runBrainConsolidate(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<boolean> {
    if (await this.brainOpsPause.isPaused()) {
      const finalText = BRAIN_OPS_BLOCKED_MESSAGE;
      await this.memory.appendMessage(conversationId, 'assistant', finalText);
      emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
      emitter.onDone(finalText);
      return true;
    }

    const skill = this.skills.get('brain');
    if (!skill) {
      return false;
    }

    emitter.onProgress?.({
      stage: 'brain',
      message: 'Scanning nodes and writing graph links…',
      percent: 36,
      toolName: 'brain',
    });

    await this.brain.reloadFromStore();

    const output = await this.executeToolCall(
      conversationId,
      { id: 'brain-consolidate', name: 'brain', arguments: { action: 'consolidate' } },
      emitter,
      trigger,
      clientPlatform,
    );

    await this.executeToolCall(
      conversationId,
      { id: 'brain-graph-after-consolidate', name: 'brain', arguments: { action: 'graph' } },
      emitter,
      trigger,
      clientPlatform,
    );

    const stats = await this.brain.getVaultStats();
    const linkedMatch = output.match(/(\d+)\s+new pairs/i);
    const linked = linkedMatch?.[1] ?? '0';
    const stampedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const finalText =
      `Relational mapping complete, sir — wrote ${linked} new link pair(s). ` +
      `Graph now has ${stats.pageCount} notes and ${stats.edgeCount} links (verified ${stampedAt} UTC). ` +
      `Refresh the graph panel if it was already open.`;

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    this.persistTurnLearning(userText, finalText);
    void this.memory.logEvent(trigger, 'Brain consolidate links');
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runBrainGraphOpen(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<boolean> {
    const skill = this.skills.get('brain');
    if (!skill) {
      return false;
    }

    emitter.onProgress?.({ stage: 'brain', message: 'Loading knowledge graph…', percent: 42, toolName: 'brain' });

    await this.executeToolCall(
      conversationId,
      { id: 'brain-graph', name: 'brain', arguments: { action: 'graph' } },
      emitter,
      trigger,
      clientPlatform,
    );

    const stats = await this.brain.getVaultStats();
    const graph = await this.brain.getGraph();
    const labels = graph.nodes.map((n) => n.label).join(', ');
    const finalText = `Opening your brain graph, sir — ${stats.pageCount} notes (${labels}) and ${stats.edgeCount} links.`;

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    this.persistTurnLearning(userText, finalText);
    void this.memory.logEvent(trigger, 'Brain graph opened');
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runExplicitLessonSave(
    conversationId: string,
    userText: string,
    history: ChatMessage[],
    emitter: OrchestratorEmitter,
    trigger: string,
  ): Promise<boolean> {
    const lessonText = extractExplicitLessonText(userText);
    if (!lessonText) {
      return false;
    }

    const contextChars =
      history.reduce((sum, m) => sum + String(m.content ?? '').length, 0) + userText.length;
    const taskRoute = this.taskRouter.resolve(userText, undefined, contextChars);

    emitter.onProgress?.({ stage: 'memory', message: 'Saving lesson…', percent: 50 });

    await this.lessons.createDirect({
      lessonText,
      triggerContext: userText.slice(0, 500),
      taskType: taskRoute.task,
    });

    const finalText = `Understood — I'll remember: ${lessonText}`;

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    void this.memory.logEvent(trigger, `Explicit lesson saved: ${lessonText.slice(0, 80)}`);
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runSaveToBrain(
    conversationId: string,
    userText: string,
    history: ChatMessage[],
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<boolean> {
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant' && String(m.content ?? '').trim());
    const priorUsers = history.filter((m) => m.role === 'user');
    const previousUser = priorUsers.length > 1 ? priorUsers[priorUsers.length - 2] : undefined;
    const content = String(lastAssistant?.content ?? previousUser?.content ?? userText).slice(0, 4000);

    emitter.onProgress?.({ stage: 'brain', message: 'Saving to brain…', percent: 40, toolName: 'brain' });

    await this.brain.remember('User Profile', content, 'entity');
    const linkMsg = await this.brain.linkUserEntityToJarvis();

    await this.executeToolCall(
      conversationId,
      { id: 'brain-graph-after-save', name: 'brain', arguments: { action: 'graph' } },
      emitter,
      trigger,
      clientPlatform,
    );

    const finalText = `Done, sir. Saved to my brain and linked to JARVIS. ${linkMsg} Open the graph to see the connection.`;

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    this.persistTurnLearning(userText, finalText);
    void this.memory.logEvent(trigger, 'Saved user info to brain');
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runAboutUser(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
  ): Promise<boolean> {
    const userPage = await this.brain.findUserEntityPage();
    const query = userPage
      ? { hits: [] as Array<{ title: string; path: string; excerpt: string; score: number }> }
      : await this.brain.query('user profile samer owner engineer', 5);
    const facts = await this.memory.recallFacts('user profile samer');

    const finalText = buildAboutUserReply({
      userPage,
      queryHits: query.hits,
      facts,
    });
    if (!finalText) {
      return false;
    }

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    this.persistTurnLearning(userText, finalText);
    void this.memory.logEvent(trigger, 'About user query');
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runLinkProfileToJarvis(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
    clientPlatform: 'desktop' | 'web',
  ): Promise<boolean> {
    emitter.onProgress?.({ stage: 'brain', message: 'Linking profile to JARVIS…', percent: 44, toolName: 'brain' });

    const linkMsg = await this.brain.linkUserEntityToJarvis();
    if (linkMsg.startsWith('No user profile')) {
      return false;
    }

    await this.executeToolCall(
      conversationId,
      { id: 'brain-graph-after-link', name: 'brain', arguments: { action: 'graph' } },
      emitter,
      trigger,
      clientPlatform,
    );

    const graph = await this.brain.getGraph();
    const finalText = `${linkMsg} Graph refreshed — ${graph.nodes.length} nodes, ${graph.edges.length} links.`;

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    this.persistTurnLearning(userText, finalText);
    void this.memory.logEvent(trigger, 'Linked user profile to JARVIS');
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }

  private async runShowBrainPage(
    conversationId: string,
    userText: string,
    emitter: OrchestratorEmitter,
    trigger: string,
  ): Promise<boolean> {
    const userPage = await this.brain.findUserEntityPage();
    if (!userPage) {
      return false;
    }

    const finalText = userPage.content;

    await this.memory.appendMessage(conversationId, 'assistant', finalText);
    this.persistTurnLearning(userText, finalText);
    void this.memory.logEvent(trigger, `Show brain page: ${userPage.path}`);
    emitter.onProgress?.({ stage: 'done', message: 'Complete', percent: 100 });
    emitter.onDone(finalText);
    return true;
  }
}

function sanitizeLinkDenial(text: string, userText: string): string {
  if (!extractUrls(userText).length) {
    return text;
  }
  if (
    /\b(don't have the ability to browse|cannot browse|can't browse|do not have the ability to browse|access web content directly|cannot access external links|can't access external links)\b/i.test(
      text,
    )
  ) {
    return 'Sir, I can fetch that link — paste the URL again and I will read it and save it to my brain with ingest_url.';
  }
  return text;
}

function sanitizeBrainDenial(text: string, userText: string): string {
  if (isBrainGraphRequest(userText)) {
    if (
      /\b(can't render|cannot render|can't display|cannot display|designed to be explored|While I can't render|I can't render visual graphs)\b/i.test(
        text,
      )
    ) {
      return 'Opening your brain graph now, sir — use the graph panel to explore linked notes.';
    }
  }
  if (
    /\b(saved to the brain|profile has been saved|linked to my LLM Wiki|exists as in-memory data rather than a file)\b/i.test(
      text,
    ) &&
    !/\b(BRAIN_GRAPH|Remembered|Ingested|Profile entity|Linked \[\[)\b/i.test(text)
  ) {
    return 'Sir, let me actually save that to the brain now — say "save that in your brain" or share your profile URL again and I will file and link it properly.';
  }
  return text;
}

function sanitizeWeatherDenial(text: string, userText: string): string {
  if (!isWeatherRequest(userText)) {
    return text;
  }
  if (
    /\b(don't have permission|do not have permission|can't access weather|cannot access weather|no permission|unable to access weather|don't have access to weather|cannot provide weather|can't provide weather)\b/i.test(
      text,
    )
  ) {
    return 'Sir, I do have live weather access via get_weather — tell me the city and I will fetch current conditions and the forecast now.';
  }
  return text;
}

function sanitizeSelfImproveDenial(text: string, userText: string): string {
  if (!/\bself[-_]?improve\b/i.test(userText)) {
    return text;
  }
  if (
    /\b(cannot modify|can't modify|can not modify|not exposed|built-in skill|isn't exposed|is not exposed|not in the repo|don't have access to its code)\b/i.test(
      text,
    )
  ) {
    return 'Sir, I misspoke — the self_improve skill is editable source at backend/src/skills/impl/self-improve.skill.ts in your GitHub repo. Tell me what to change and I will inspect that file, write the update, and open a pull request.';
  }
  return text;
}

function selfImproveProgressPercent(action: string): number {
  switch (action) {
    case 'status':
      return 12;
    case 'inspect':
      return 28;
    case 'apply_preset':
      return 48;
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
    case 'apply_preset':
      return 'Applying upgrade preset';
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

function estimateTurnTokens(messages: ChatMessage[], response: string): number {
  const inputChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  return Math.ceil((inputChars + response.length) / 4);
}
