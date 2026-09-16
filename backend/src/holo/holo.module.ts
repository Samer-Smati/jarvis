import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrainModule } from '../brain/brain.module';
import { MemoryModule } from '../memory/memory.module';
import { CalendarEventEntity } from '../skills/entities/calendar-event.entity';
import { ReminderEntity } from '../skills/entities/reminder.entity';
import { HoloController } from './holo.controller';
import { HoloService } from './holo.service';

@Module({
  imports: [BrainModule, MemoryModule, TypeOrmModule.forFeature([ReminderEntity, CalendarEventEntity])],
  controllers: [HoloController],
  providers: [HoloService],
  exports: [HoloService],
})
export class HoloModule {}
