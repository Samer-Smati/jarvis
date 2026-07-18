import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { SkillsModule } from '../skills/skills.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [ChatModule, SkillsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
