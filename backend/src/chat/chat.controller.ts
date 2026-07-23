import { BadRequestException, Body, Controller, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GuardrailService } from '../guardrails/guardrail.service';
import { LlmService } from '../llm/llm.service';
import { ConversationMessageEntity } from '../memory/entities/conversation-message.entity';
import { BrainService } from '../brain/brain.service';
import { MemoryService } from '../memory/memory.service';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { ReminderEntity } from '../skills/entities/reminder.entity';
import { SkillRegistry } from '../skills/skill.registry';

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
    return {
      provider: this.orchestrator.providerName,
      llmReady: llmReady.ok,
      llmModel: llmReady.model,
      llmError: llmReady.error,
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
    return this.memory.listConversationMessages(id);
  }

  @Post('conversations/:id/sync')
  async syncConversation(
    @Param('id') id: string,
    @Body() body: { messages?: Array<{ role: string; content: string; createdAt?: string }> },
  ) {
    const count = await this.memory.replaceConversation(id, body?.messages ?? []);
    return { ok: true, count };
  }

  @Get('conversations/:id/recap')
  async conversationRecap(@Param('id') id: string) {
    const all = await this.memory.listConversationMessages(id);
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

  @Get('memory/facts')
  facts() {
    return this.memory.listFacts();
  }

  @Get('brain/status')
  async brainStatus() {
    const status = await this.brain.status();
    const pages = await this.brain.listPages();
    return { status, pageCount: pages.length, pages: pages.slice(0, 50) };
  }

  @Get('brain/graph')
  brainGraph() {
    return this.brain.getGraph();
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
    const aborted = this.orchestrator.killSwitch(body?.conversationId);
    return { aborted };
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
