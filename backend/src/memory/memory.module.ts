import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationMessageEntity } from './entities/conversation-message.entity';
import { EpisodicEventEntity } from './entities/episodic-event.entity';
import { SemanticMemoryEntity } from './entities/semantic-memory.entity';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { UserProjectEntity } from './entities/user-project.entity';
import { MemoryController } from './memory.controller';
import { MemoryRepository } from './memory.repository';
import { MemoryService } from './memory.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationMessageEntity,
      EpisodicEventEntity,
      SemanticMemoryEntity,
      UserPreferenceEntity,
      UserProjectEntity,
    ]),
  ],
  controllers: [MemoryController],
  providers: [MemoryRepository, MemoryService],
  exports: [MemoryService, MemoryRepository],
})
export class MemoryModule {}
