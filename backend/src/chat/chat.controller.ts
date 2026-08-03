import { BadRequestException, Body, Controller, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GuardrailService } from '../guardrails/guardrail.service';
import { LlmService } from '../llm/llm.service';
import { ConversationMessageEntity } from '../memory/entities/conversation-message.entity';
import { BrainOpsPauseService } from '../brain/brain-ops-pause.service';
import { BrainService, BRAIN_PRUNE_META_CONFIRM_PHRASE, BRAIN_REHYDRATE_CONFIRM_PHRASE } from '../brain/brain.service';
import { FACTORY_RESET_CONFIRM_PHRASE, FactoryResetService } from '../memory/factory-reset.service';
import { MemoryService } from '../memory/memory.service';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { ReminderEntity } from '../skills/entities/reminder.entity';
import { SkillRegistry } from '../skills/skill.registry';
import { assertValidConversationId } from './conversation-id.util';

const RECAP_PROMPT = `You are J.A.R.V.I.S. The user is reopening the assistant. Briefly recap the last exchange in 2-3 short speakable sentences as a status update. Mention when things were discussed if timestamps are provided. Address them as "sir". Warm Iron Man butler tone. No markdown or bullet points. Use the same language as the conversation.`;

const RECAP_TIMEOUT_MS = 12000;

@Controller('api')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly skills: SkillRegistry,
    private readonly memory: MemoryService,
    private readonly brain: BrainService,
    private readonly brainOpsPause: BrainOpsPauseService,
    private readonly factoryReset: FactoryResetService,
    private readonly guardrails: GuardrailService,
    private readonly llm: LlmService,
    @InjectRepository(ReminderEntity)
    private readonly reminders: Repository<ReminderEntity>,
  ) {}

  @Post('provider')
  setProvider(@Body() body: { provider: string }) {
    if (!this.llm.setProvider(body?.provider)) {
      throw new BadRequestException(
        `Unknown provider "${body?.provider}". Available: ${this.llm.available.join(', ')}.`,
      );
    }
    return { provider: this.llm.name };
  }

  @Get('status')
  async status() {
    const llmReady = await this.llm.isReady();
    const configuredProvider = this.llm.name;
    const readyProvider = llmReady.provider ?? configuredProvider;
    const servingProvider = this.llm.servingProvider;
    const servingModel = this.llm.servingModel;
    return {
      provider: configuredProvider,
      configuredProvider,
      readyProvider,
      servingProvider: servingProvider ?? readyProvider,
      servingModel,
      llmReady: llmReady.ok,
      llmModel: llmReady.model,
      llmError: llmReady.error,
      providerMismatch:
        !!servingProvider &&
        servingProvider !== configuredProvider &&
        `Last response used ${servingProvider}${servingModel ? ` (${servingModel})` : ''}, not configured ${configuredProvider}.`,
      activeRuns: this.orchestrator.activeRunCount(),
      pendingConfirmations: this.guardrails.pendingRequests(),
    };
  }

  @Get('skills')
  listSkills() {
    return this.skills.list().map(({ skill, enabled }) => ({
      name: skill.name,
      description: skill.description,
      requiresConfirmation: skill.requiresConfirmation,
      enabled,
    }));
  }

  @Post('skills/:name/enabled')
  setSkillEnabled(@Param('name') name: string, @Body() body: { enabled: boolean }) {
    this.skills.setEnabled(name, !!body?.enabled);
    return { name, enabled: !!body?.enabled };
  }

  @Get('conversations/:id/messages')
  conversationMessages(@Param('id') id: string) {
    return this.memory.listConversationMessages(assertValidConversationId(id));
  }

  @Post('conversations/:id/sync')
  async syncConversation(
    @Param('id') id: string,
    @Body() body: { messages?: Array<{ role: string; content: string; createdAt?: string }> },
  ) {
    const conversationId = assertValidConversationId(id);
    const count = await this.memory.replaceConversation(conversationId, body?.messages ?? []);
    return { ok: true, count };
  }

  @Get('conversations/:id/recap')
  async conversationRecap(@Param('id') id: string) {
    const conversationId = assertValidConversationId(id);
    const all = await this.memory.listConversationMessages(conversationId);
    const last3 = all
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-3);
    if (!last3.length) {
      return { recap: null };
    }

    const ready = await this.llm.isReady();
    if (!ready.ok) {
      return { recap: this.fallbackRecap(last3), source: 'local' };
    }

    const transcript = last3
      .map((m) => `${m.role.toUpperCase()} [${formatRecapTimestamp(m.createdAt)}]: ${m.content}`)
      .join('\n\n');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RECAP_TIMEOUT_MS);
      const result = await this.llm.chat({
        messages: [
          { role: 'system', content: RECAP_PROMPT },
          { role: 'user', content: `Last messages:\n\n${transcript}` },
        ],
        signal: controller.signal,
      });
      clearTimeout(timer);
      const recap = result.content?.trim();
      if (recap) {
        return { recap, source: 'llm' };
      }
    } catch (error) {
      this.logger.warn(`Recap LLM failed: ${error instanceof Error ? error.message : error}`);
    }

    return { recap: this.fallbackRecap(last3), source: 'local' };
  }

  private fallbackRecap(messages: ConversationMessageEntity[]): string {
    const parts = messages.map((m) => {
      const label = m.role === 'user' ? 'You' : 'I';
      const when = formatRecapTimestamp(m.createdAt);
      const snippet = m.content.length > 120 ? `${m.content.slice(0, 120).trim()}…` : m.content.trim();
      return `${label} (${when}): ${snippet}`;
    });
    return `Here's a quick recap of our last exchange. ${parts.join(' ')}`;
  }

  @Get('audit')
  auditLog() {
    return this.guardrails.recentAudit();
  }

  @Get('events')
  events() {
    return this.memory.recentEvents();
  }

  @Get('brain/status')
  async brainStatus() {
    const status = await this.brain.status();
    const stats = await this.brain.getVaultStats();
    const pages = await this.brain.listPages();
    return {
      status,
      pageCount: stats.pageCount,
      edgeCount: stats.edgeCount,
      source: stats.source,
      pages: pages.slice(0, 50),
    };
  }

  @Get('brain/cleanup-history')
  brainCleanupHistory() {
    return this.brain.getCleanupHistory();
  }

  @Get('brain/ops-status')
  brainOpsStatus() {
    return this.brainOpsPause.status();
  }

  @Post('brain/ops-pause')
  async pauseBrainOps(@Body() body: { reason?: string }) {
    return this.brainOpsPause.pause(body?.reason);
  }

  @Post('brain/ops-resume')
  async brainOpsResume() {
    return this.brainOpsPause.resume();
  }

  @Post('brain/prune-meta-facts')
  async brainPruneMetaFacts(@Body() body: { confirm?: string }) {
    const confirm = body?.confirm?.trim();
    if (confirm !== BRAIN_PRUNE_META_CONFIRM_PHRASE) {
      throw new BadRequestException(
        `Refused — send { "confirm": "${BRAIN_PRUNE_META_CONFIRM_PHRASE}" } to remove meta-complaint fact pages.`,
      );
    }
    try {
      const result = await this.brain.pruneMetaFactPages(confirm);
      return { ok: true, ...result };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get('brain/graph')
  brainGraph() {
    return this.brain.getGraph();
  }

  @Get('brain/rehydrate/preview')
  async brainRehydratePreview() {
    return this.brain.previewRehydrateFromPg();
  }

  @Post('brain/rehydrate')
  async brainRehydrate(
    @Body() body: { confirm?: string; expectedMinPages?: number },
  ) {
    const confirm = body?.confirm?.trim();
    if (confirm !== BRAIN_REHYDRATE_CONFIRM_PHRASE) {
      throw new BadRequestException(
        `Refused — send { "confirm": "${BRAIN_REHYDRATE_CONFIRM_PHRASE}", "expectedMinPages": 30 } after reviewing GET /api/brain/rehydrate/preview.`,
      );
    }
    try {
      const result = await this.brain.rehydrateFromPg({
        confirm,
        expectedMinPages: body?.expectedMinPages,
      });
      return { ok: true, ...result };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get('brain/query')
  async brainQuery(@Query('q') q?: string) {
    const query = q ?? '';
    if (!query.trim()) {
      throw new BadRequestException('Query parameter "q" is required.');
    }
    return this.brain.query(query);
  }

  @Get('reminders')
  listReminders() {
    return this.reminders.find({ where: { fired: false }, order: { dueAt: 'ASC' } });
  }

  @Post('kill-switch')
  killSwitch(@Body() body: { conversationId?: string }) {
    const conversationId = body?.conversationId?.trim();
    if (conversationId) {
      assertValidConversationId(conversationId);
    }
    const aborted = this.orchestrator.killSwitch(conversationId);
    return { aborted };
  }

  @Post('factory-reset')
  async factoryResetEndpoint(@Body() body: { confirm?: string }) {
    const confirm = body?.confirm?.trim();
    if (confirm !== FACTORY_RESET_CONFIRM_PHRASE) {
      throw new BadRequestException(
        `Refused — send { "confirm": "${FACTORY_RESET_CONFIRM_PHRASE}" } to wipe all memories, conversations, and brain data. This cannot be undone.`,
      );
    }
    this.orchestrator.killSwitch();
    try {
      return await this.factoryReset.resetToNewborn(confirm);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}

function formatRecapTimestamp(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
