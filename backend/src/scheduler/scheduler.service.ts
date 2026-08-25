import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, Repository } from 'typeorm';
import { ChatGateway } from '../chat/chat.gateway';
import { GoogleCalendarService } from '../integrations/google-calendar.service';
import { MemoryService } from '../memory/memory.service';
import { LessonsService } from '../lessons/lessons.service';
import { CalendarEventEntity } from '../skills/entities/calendar-event.entity';
import { ReminderEntity } from '../skills/entities/reminder.entity';
import { CryptoMonitorSkill } from '../skills/impl/crypto-monitor.skill';

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
    private readonly lessons: LessonsService,
    private readonly googleCalendar: GoogleCalendarService,
    private readonly cryptoMonitor: CryptoMonitorSkill,
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

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async runCryptoPortfolioCheck(): Promise<void> {
    try {
      await this.cryptoMonitor.runDailyCheck();
    } catch (error) {
      this.logger.warn(`Crypto portfolio check failed: ${(error as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_WEEK)
  async pruneStaleMemory(): Promise<void> {
    const factsArchived = await this.memory.pruneStaleMemories(90);
    const lessonsArchived = await this.lessons.archiveStale(30);
    if (factsArchived > 0 || lessonsArchived > 0) {
      await this.memory.logEvent(
        'memory_prune',
        `Pruned ${factsArchived} stale facts and archived ${lessonsArchived} stale lessons (pinned untouched).`,
      );
      this.logger.log(`Weekly prune: ${factsArchived} facts, ${lessonsArchived} lessons archived.`);
    }
  }
}
