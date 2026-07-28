import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isServerlessRuntime, requiresWebSearch } from '../orchestrator/fast-chat.util';
import type { ChatImagePart } from './llm.types';

export type TaskType = 'quick_qa' | 'coding' | 'reasoning' | 'creative' | 'tool_heavy' | 'personal';

export interface RouteConfig {
  provider: string;
  model?: string;
  maxTokens?: number;
  maxInputChars?: number;
  timeoutMs?: number;
}

export interface TaskRouteResult {
  task: TaskType;
  requestedTask: TaskType;
  runtime: 'vercel' | 'desktop';
  route: RouteConfig;
  reason: string;
  override?: boolean;
  budgetDowngraded?: boolean;
  contextDowngraded?: boolean;
  userNotice?: string;
}

interface RoutingFile {
  default: RouteConfig;
  routes: Record<TaskType, { vercel: RouteConfig; desktop: RouteConfig }>;
  budget?: { dailyTokenCap?: number; dailyCostCapUsd?: number };
}

const CODING_PATTERN =
  /\b(refactor|implement|debug|fix bug|typescript|javascript|python|\.ts\b|\.js\b|\.py\b|orchestrator|component|api endpoint|pull request|git commit|nest\.?js|angular)\b/i;
const CREATIVE_PATTERN = /\b(write a story|poem|creative|brainstorm|imagine|fiction|song lyrics)\b/i;
const REASONING_PATTERN = /\b(analyze|compare|explain why|pros and cons|trade.?off|architecture|design decision|strategy)\b/i;
const TOOL_HEAVY_PATTERN =
  /\b(upgrade|self.?improve|pull request|github|deploy|ingest|calendar|weather|search the web|smart home|web search|check online|look (this|it) up)\b/i;

const DEFAULT_MAX_INPUT: Record<TaskType, number> = {
  quick_qa: 12_000,
  coding: 80_000,
  reasoning: 40_000,
  creative: 30_000,
  tool_heavy: 60_000,
  personal: 30_000,
};

const CONTEXT_OVERFLOW_FALLBACK: TaskType = 'reasoning';

@Injectable()
export class TaskRouterService {
  private readonly logger = new Logger(TaskRouterService.name);
  private readonly configPath: string;
  private config: RoutingFile;
  private configMtime = 0;
  private dailyTokens = 0;
  private dailyCostUsd = 0;
  private budgetDay = new Date().toDateString();
  private manualOverride: TaskType | null = null;

  constructor() {
    this.configPath = join(__dirname, 'llm-routing.config.json');
    this.config = this.loadConfigFile();
  }

  setManualOverride(task: TaskType | null): void {
    this.manualOverride = task;
  }

  classify(text: string, images?: ChatImagePart[]): TaskType {
    if (this.manualOverride) {
      return this.manualOverride;
    }

    const trimmed = text.trim();
    if (/^\/model\s+(quick_qa|coding|reasoning|creative|tool_heavy|personal)\b/i.test(trimmed)) {
      const match = trimmed.match(/^\/model\s+(quick_qa|coding|reasoning|creative|tool_heavy|personal)/i);
      if (match?.[1]) {
        this.manualOverride = match[1].toLowerCase() as TaskType;
        return this.manualOverride;
      }
    }

    if (images?.length) {
      return 'reasoning';
    }
    if (requiresWebSearch(trimmed)) {
      return 'tool_heavy';
    }
    if (TOOL_HEAVY_PATTERN.test(trimmed)) {
      return 'tool_heavy';
    }
    if (CODING_PATTERN.test(trimmed)) {
      return 'coding';
    }
    if (CREATIVE_PATTERN.test(trimmed)) {
      return 'creative';
    }
    if (REASONING_PATTERN.test(trimmed)) {
      return 'reasoning';
    }
    if (trimmed.length < 40 && !trimmed.includes('?')) {
      return 'quick_qa';
    }
    if (trimmed.endsWith('?') && trimmed.length < 120) {
      return 'quick_qa';
    }
    return 'reasoning';
  }

  resolve(text: string, images?: ChatImagePart[], contextChars = 0): TaskRouteResult {
    this.reloadConfigIfChanged();
    this.resetBudgetIfNewDay();

    const requestedTask = this.classify(text, images);
    const runtime = isServerlessRuntime() ? 'vercel' : 'desktop';
    let task = requestedTask;
    let budgetDowngraded = false;
    let contextDowngraded = false;
    const notices: string[] = [];

    if (this.isOverBudget()) {
      budgetDowngraded = true;
      task = 'quick_qa';
      const status = this.getBudgetStatus();
      const reason = `daily budget cap reached (${status.dailyTokens}/${status.capTokens} tokens)`;
      this.logger.warn(`Route downgrade: ${requestedTask} → quick_qa — ${reason}`);
      notices.push(`Daily LLM budget reached, sir — I switched to a lighter model for this reply.`);
    }

    let routeEntry = this.config.routes[task]?.[runtime] ?? this.config.default;
    const maxInput = routeEntry.maxInputChars ?? DEFAULT_MAX_INPUT[task] ?? 30_000;

    if (contextChars > maxInput && task === 'quick_qa') {
      contextDowngraded = true;
      task = CONTEXT_OVERFLOW_FALLBACK;
      routeEntry = this.config.routes[task]?.[runtime] ?? this.config.default;
      const reason = `context ${contextChars} chars exceeds quick_qa cap ${maxInput}`;
      this.logger.warn(`Route downgrade: ${requestedTask} → ${task} — ${reason}`);
      notices.push(
        `This turn had a large conversation history, sir — I upgraded from the quick model to handle context properly.`,
      );
    }

    const reason = this.manualOverride
      ? `manual override: ${task}`
      : budgetDowngraded
        ? `budget cap fallback (requested ${requestedTask})`
        : contextDowngraded
          ? `context overflow fallback (requested ${requestedTask})`
          : `classified as ${task} on ${runtime}`;

    this.logger.log(`Route: ${reason} → ${routeEntry.provider}/${routeEntry.model ?? 'default'}`);

    return {
      task,
      requestedTask,
      runtime,
      route: routeEntry,
      reason,
      override: !!this.manualOverride,
      budgetDowngraded,
      contextDowngraded,
      userNotice: notices.length ? notices.join(' ') : undefined,
    };
  }

  /** For tests — force budget state. */
  setBudgetState(tokens: number, costUsd = 0): void {
    this.dailyTokens = tokens;
    this.dailyCostUsd = costUsd;
  }

  recordUsage(estimatedTokens: number, estimatedCostUsd = 0): void {
    this.resetBudgetIfNewDay();
    this.dailyTokens += estimatedTokens;
    this.dailyCostUsd += estimatedCostUsd;
  }

  getBudgetStatus(): { dailyTokens: number; dailyCostUsd: number; capTokens: number; capCostUsd: number } {
    this.resetBudgetIfNewDay();
    return {
      dailyTokens: this.dailyTokens,
      dailyCostUsd: this.dailyCostUsd,
      capTokens: this.config.budget?.dailyTokenCap ?? 500_000,
      capCostUsd: this.config.budget?.dailyCostCapUsd ?? 5,
    };
  }

  reloadConfigIfChanged(): void {
    try {
      const mtime = statSync(this.configPath).mtimeMs;
      if (mtime !== this.configMtime) {
        this.config = this.loadConfigFile();
        this.configMtime = mtime;
        this.logger.log('Reloaded llm-routing.config.json');
      }
    } catch {
      this.config = this.loadConfigFile();
    }
  }

  private loadConfigFile(): RoutingFile {
    const candidates = [
      this.configPath,
      join(__dirname, '..', 'llm', 'llm-routing.config.json'),
      join(process.cwd(), 'backend', 'dist', 'llm', 'llm-routing.config.json'),
      join(process.cwd(), 'dist', 'llm', 'llm-routing.config.json'),
    ];
    for (const filePath of candidates) {
      if (existsSync(filePath)) {
        return JSON.parse(readFileSync(filePath, 'utf8')) as RoutingFile;
      }
    }
    throw new Error(`Routing config not found (checked: ${candidates.join(', ')})`);
  }

  private isOverBudget(): boolean {
    const capTokens = this.config.budget?.dailyTokenCap ?? 500_000;
    const capCost = this.config.budget?.dailyCostCapUsd ?? 5;
    return this.dailyTokens >= capTokens || this.dailyCostUsd >= capCost;
  }

  private resetBudgetIfNewDay(): void {
    const today = new Date().toDateString();
    if (today !== this.budgetDay) {
      this.budgetDay = today;
      this.dailyTokens = 0;
      this.dailyCostUsd = 0;
    }
  }
}
