import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationMessageEntity } from './entities/conversation-message.entity';
import { EpisodicEventEntity } from './entities/episodic-event.entity';
import { SemanticMemoryEntity } from './entities/semantic-memory.entity';
import { MemoryService } from './memory.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationMessageEntity,
      EpisodicEventEntity,
      SemanticMemoryEntity,
    ]),
  ],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
