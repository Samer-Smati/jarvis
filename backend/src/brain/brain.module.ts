import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PgInitService } from '../database/pg-init.service';
import { BrainPgStore } from './brain-pg.store';
import { BrainService } from './brain.service';
import { BrainEdgeEntity } from './entities/brain-edge.entity';
import { BrainPageEntity } from './entities/brain-page.entity';
import { MemoryChunkEntity } from './entities/memory-chunk.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([BrainPageEntity, BrainEdgeEntity, MemoryChunkEntity])],
  providers: [BrainService, BrainPgStore, PgInitService],
  exports: [BrainService, BrainPgStore],
})
export class BrainModule {}
