import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MemoryRepository } from '../memory/memory.repository';
import {
  BRAIN_OPS_BLOCKED_MESSAGE,
  BrainMutatingAction,
  isBrainMutatingAction,
} from './brain-ops.util';

const PAUSED_KEY = 'brain_ops_paused';
const REASON_KEY = 'brain_ops_paused_reason';
const SINCE_KEY = 'brain_ops_paused_since';
const CACHE_TTL_MS = 5000;

export interface BrainOpsStatus {
  paused: boolean;
  reason?: string;
  since?: string;
}

@Injectable()
export class BrainOpsPauseService implements OnModuleInit {
  private readonly logger = new Logger(BrainOpsPauseService.name);
  private cache: BrainOpsStatus | null = null;
  private cacheAt = 0;

  constructor(private readonly memoryRepo: MemoryRepository) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.memoryRepo.getPreferenceValue(PAUSED_KEY);
    if (existing === null) {
      await this.pause('Default paused on deploy until you resume brain operations.');
      this.logger.warn('Brain ops initialized paused (default safe state).');
    }
  }

  blockedMessage(): string {
    return BRAIN_OPS_BLOCKED_MESSAGE;
  }

  async status(): Promise<BrainOpsStatus> {
    if (this.cache && Date.now() - this.cacheAt < CACHE_TTL_MS) {
      return this.cache;
    }
    const pausedRaw = await this.memoryRepo.getPreferenceValue(PAUSED_KEY);
    const paused = pausedRaw !== 'false';
    const reason = (await this.memoryRepo.getPreferenceValue(REASON_KEY)) ?? undefined;
    const since = (await this.memoryRepo.getPreferenceValue(SINCE_KEY)) ?? undefined;
    this.cache = { paused, reason, since };
    this.cacheAt = Date.now();
    return this.cache;
  }

  async isPaused(): Promise<boolean> {
    return (await this.status()).paused;
  }

  async pause(reason?: string): Promise<BrainOpsStatus> {
    const since = new Date().toISOString();
    await this.memoryRepo.upsertPreference(PAUSED_KEY, 'true', 'brain_ops');
    if (reason?.trim()) {
      await this.memoryRepo.upsertPreference(REASON_KEY, reason.trim().slice(0, 500), 'brain_ops');
    }
    await this.memoryRepo.upsertPreference(SINCE_KEY, since, 'brain_ops');
    this.invalidateCache();
    this.logger.warn(`Brain ops PAUSED${reason ? `: ${reason.slice(0, 80)}` : ''}`);
    return this.status();
  }

  async resume(): Promise<BrainOpsStatus> {
    await this.memoryRepo.upsertPreference(PAUSED_KEY, 'false', 'brain_ops');
    await this.memoryRepo.upsertPreference(REASON_KEY, '', 'brain_ops');
    this.invalidateCache();
    this.logger.log('Brain ops RESUMED');
    return this.status();
  }

  async assertMutationAllowed(action: BrainMutatingAction | string): Promise<void> {
    if (!isBrainMutatingAction(String(action))) {
      return;
    }
    if (await this.isPaused()) {
      throw new Error(BRAIN_OPS_BLOCKED_MESSAGE);
    }
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheAt = 0;
  }
}
