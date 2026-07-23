import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalendarEventEntity } from './entities/calendar-event.entity';
import { ReminderEntity } from './entities/reminder.entity';
import { CalendarSkill } from './impl/calendar.skill';
import { CodingSkill } from './impl/coding.skill';
import { DatetimeSkill } from './impl/datetime.skill';
import { DeviceControlSkill } from './impl/device-control.skill';
import { EmailSkill } from './impl/email.skill';
import { FilesystemSkill } from './impl/filesystem.skill';
import { RemindersSkill } from './impl/reminders.skill';
import { SmartHomeSkill } from './impl/smart-home.skill';
import { MediaSkill } from './impl/stub.skills';
import { BrainSkill } from './impl/brain.skill';
import { SelfImproveSkill } from './impl/self-improve.skill';
import { WeatherSkill } from './impl/weather.skill';
import { WebSearchSkill } from './impl/web-search.skill';
import { Skill, SKILLS } from './skill.interface';
import { SkillRegistry } from './skill.registry';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ReminderEntity, CalendarEventEntity])],
  providers: [
    DatetimeSkill,
    WebSearchSkill,
    WeatherSkill,
    RemindersSkill,
    CalendarSkill,
    FilesystemSkill,
    DeviceControlSkill,
    EmailSkill,
    CodingSkill,
    SmartHomeSkill,
    MediaSkill,
    BrainSkill,
    SelfImproveSkill,
    {
      provide: SKILLS,
      inject: [
        DatetimeSkill,
        WebSearchSkill,
        WeatherSkill,
        RemindersSkill,
        CalendarSkill,
        FilesystemSkill,
        DeviceControlSkill,
        EmailSkill,
        CodingSkill,
        SmartHomeSkill,
        MediaSkill,
        BrainSkill,
        SelfImproveSkill,
      ],
      useFactory: (...skills: Skill[]) => skills,
    },
    SkillRegistry,
  ],
  exports: [SkillRegistry, TypeOrmModule],
})
export class SkillsModule {}
