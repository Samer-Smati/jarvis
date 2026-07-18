import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, Repository } from 'typeorm';
import { ChatGateway } from '../chat/chat.gateway';
import { GoogleCalendarService } from '../integrations/google-calendar.service';
import { MemoryService } from '../memory/memory.service';
import { CalendarEventEntity } from '../skills/entities/calendar-event.entity';
import { ReminderEntity } from '../skills/entities/reminder.entity';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectRepository(ReminderEntity)
    private readonly reminders: Repository<ReminderEntity>,
    @InjectRepository(CalendarEventEntity)
    private readonly calendarEvents: Repository<CalendarEventEntity>,
    private readonly gateway: ChatGateway,
    private readonly memory: MemoryService,
    private readonly googleCalendar: GoogleCalendarService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async fireDueReminders(): Promise<void> {
    const pending = await this.reminders.count({ where: { fired: false } });
    if (!pending) {
      return;
    }
    const due = await this.reminders.find({
      where: { fired: false, dueAt: LessThanOrEqual(new Date()) },
    });
    for (const reminder of due) {
      reminder.fired = true;
      await this.reminders.save(reminder);
      this.gateway.notifyReminderFired(reminder);
      await this.memory.logEvent('reminder', `Reminder fired: ${reminder.text}`);
      this.logger.log(`Reminder fired: ${reminder.text}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async morningBriefing(): Promise<void> {
    const now = new Date();
    const end = new Date(now.getTime() + 24 * 3600 * 1000);
    const parts: string[] = ['Good morning, sir. Here is your briefing.'];

    const localEvents = await this.calendarEvents.find({
      where: { startAt: Between(now, end) },
      order: { startAt: 'ASC' },
      take: 8,
    });
    if (localEvents.length) {
      parts.push(`You have ${localEvents.length} local calendar item(s) today.`);
    } else {
      parts.push('Your local calendar is clear for the next day.');
    }

    if (this.googleCalendar.isConfigured()) {
      try {
        const google = await this.googleCalendar.listEvents(now, end);
        if (google.length) {
          parts.push(`Google Calendar shows ${google.length} upcoming event(s).`);
        }
      } catch (error) {
        this.logger.warn(`Morning briefing Google Calendar: ${(error as Error).message}`);
      }
    }

    const pendingReminders = await this.reminders.count({ where: { fired: false } });
    if (pendingReminders) {
      parts.push(`${pendingReminders} reminder(s) are still pending.`);
    }

    const text = parts.join(' ');
    this.gateway.notifyMorningBriefing(text);
    await this.memory.logEvent('briefing', text);
    this.logger.log(`Morning briefing: ${text}`);
  }
}
