import { Module } from '@nestjs/common';
import { BrainModule } from '../brain/brain.module';
import { MemoryModule } from '../memory/memory.module';
import { HoloController } from './holo.controller';
import { HoloService } from './holo.service';

@Module({
  imports: [BrainModule, MemoryModule],
  controllers: [HoloController],
  providers: [HoloService],
  exports: [HoloService],
})
export class HoloModule {}
