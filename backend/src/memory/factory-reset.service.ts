import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrainPgStore } from '../brain/brain-pg.store';
import { BrainService } from '../brain/brain.service';
import { InteractionLogEntity } from '../feedback/entities/interaction-log.entity';
import { AuditLogEntity } from '../guardrails/entities/audit-log.entity';
import { LessonEntity } from '../lessons/entities/lesson.entity';
import { DevicePermissionEntity } from '../permissions/entities/device-permission.entity';
import { CalendarEventEntity } from '../skills/entities/calendar-event.entity';
import { PortfolioEntity } from '../skills/entities/portfolio.entity';
import { PriceHistoryEntity } from '../skills/entities/price-history.entity';
import { ReminderEntity } from '../skills/entities/reminder.entity';
import { ConversationBlobStore } from './conversation-blob.store';
import { ConversationMessageEntity } from './entities/conversation-message.entity';
import { EpisodicEventEntity } from './entities/episodic-event.entity';
import { SemanticMemoryEntity } from './entities/semantic-memory.entity';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { UserProjectEntity } from './entities/user-project.entity';

export const FACTORY_RESET_CONFIRM_PHRASE = 'NEWBORN';

export interface FactoryResetResult {
  ok: true;
  confirm: typeof FACTORY_RESET_CONFIRM_PHRASE;
  brainPageCount: number;
  cleared: Record<string, number>;
  conversationBlobsDeleted: number;
}

@Injectable()
export class FactoryResetService {
  private readonly logger = new Logger(FactoryResetService.name);
  private readonly conversationBlobs = new ConversationBlobStore();

  constructor(
    private readonly brain: BrainService,
    private readonly brainPg: BrainPgStore,
    @InjectRepository(ConversationMessageEntity)
    private readonly messages: Repository<ConversationMessageEntity>,
    @InjectRepository(EpisodicEventEntity)
    private readonly events: Repository<EpisodicEventEntity>,
    @InjectRepository(SemanticMemoryEntity)
    private readonly facts: Repository<SemanticMemoryEntity>,
    @InjectRepository(UserPreferenceEntity)
    private readonly preferences: Repository<UserPreferenceEntity>,
    @InjectRepository(UserProjectEntity)
    private readonly projects: Repository<UserProjectEntity>,
    @InjectRepository(LessonEntity)
    private readonly lessons: Repository<LessonEntity>,
    @InjectRepository(InteractionLogEntity)
    private readonly interactions: Repository<InteractionLogEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly audit: Repository<AuditLogEntity>,
    @InjectRepository(ReminderEntity)
    private readonly reminders: Repository<ReminderEntity>,
    @InjectRepository(CalendarEventEntity)
    private readonly calendar: Repository<CalendarEventEntity>,
    @InjectRepository(PortfolioEntity)
    private readonly portfolio: Repository<PortfolioEntity>,
    @InjectRepository(PriceHistoryEntity)
    private readonly priceHistory: Repository<PriceHistoryEntity>,
    @InjectRepository(DevicePermissionEntity)
    private readonly permissions: Repository<DevicePermissionEntity>,
  ) {}

  async resetToNewborn(confirm: string): Promise<FactoryResetResult> {
    if (confirm !== FACTORY_RESET_CONFIRM_PHRASE) {
      throw new Error(
        `Factory reset refused — confirm must be exactly "${FACTORY_RESET_CONFIRM_PHRASE}".`,
      );
    }

    this.logger.warn('Factory reset (NEWBORN) started — wiping durable JARVIS state.');

    const cleared: Record<string, number> = {};
    // Lessons before interaction log (possible FK / source references).
    cleared.lessons = await this.clearRepo(this.lessons);
    cleared.interactionLog = await this.clearRepo(this.interactions);
    cleared.conversationMessages = await this.clearRepo(this.messages);
    cleared.episodicEvents = await this.clearRepo(this.events);
    cleared.semanticMemories = await this.clearRepo(this.facts);
    cleared.userPreferences = await this.clearRepo(this.preferences);
    cleared.userProjects = await this.clearRepo(this.projects);
    cleared.auditLog = await this.clearRepo(this.audit);
    cleared.reminders = await this.clearRepo(this.reminders);
    cleared.calendarEvents = await this.clearRepo(this.calendar);
    cleared.cryptoPriceHistory = await this.clearRepo(this.priceHistory);
    cleared.cryptoPortfolio = await this.clearRepo(this.portfolio);
    cleared.devicePermissions = await this.clearRepo(this.permissions);
    cleared.memoryChunks = await this.brainPg.clearAllChunks();

    const conversationBlobsDeleted = await this.conversationBlobs.deleteAll();
    const brain = await this.brain.resetToNewborn();

    this.logger.warn(
      `Factory reset complete — seed brain pages=${brain.pageCount}, blobs deleted=${conversationBlobsDeleted}.`,
    );

    return {
      ok: true,
      confirm: FACTORY_RESET_CONFIRM_PHRASE,
      brainPageCount: brain.pageCount,
      cleared,
      conversationBlobsDeleted,
    };
  }

  private async clearRepo<T extends object>(repo: Repository<T>): Promise<number> {
    const count = await repo.count();
    if (!count) {
      return 0;
    }
    await repo.clear();
    return count;
  }
}
