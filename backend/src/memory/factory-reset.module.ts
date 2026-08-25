import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InteractionLogEntity } from '../feedback/entities/interaction-log.entity';
import { AuditLogEntity } from '../guardrails/entities/audit-log.entity';
import { LessonEntity } from '../lessons/entities/lesson.entity';
import { DevicePermissionEntity } from '../permissions/entities/device-permission.entity';
import { CalendarEventEntity } from '../skills/entities/calendar-event.entity';
import { PortfolioEntity } from '../skills/entities/portfolio.entity';
import { PriceHistoryEntity } from '../skills/entities/price-history.entity';
import { ReminderEntity } from '../skills/entities/reminder.entity';
import { ConversationMessageEntity } from './entities/conversation-message.entity';
import { EpisodicEventEntity } from './entities/episodic-event.entity';
import { SemanticMemoryEntity } from './entities/semantic-memory.entity';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { UserProjectEntity } from './entities/user-project.entity';
import { FactoryResetService } from './factory-reset.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationMessageEntity,
      EpisodicEventEntity,
      SemanticMemoryEntity,
      UserPreferenceEntity,
      UserProjectEntity,
      LessonEntity,
      InteractionLogEntity,
      AuditLogEntity,
      ReminderEntity,
      CalendarEventEntity,
      PortfolioEntity,
      PriceHistoryEntity,
      DevicePermissionEntity,
    ]),
  ],
  providers: [FactoryResetService],
  exports: [FactoryResetService],
})
export class FactoryResetModule {}
