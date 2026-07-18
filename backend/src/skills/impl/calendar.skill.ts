import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, Repository } from 'typeorm';
import { GoogleCalendarService } from '../../integrations/google-calendar.service';
import { CalendarEventEntity } from '../entities/calendar-event.entity';
import { Skill, SkillResult } from '../skill.interface';

@Injectable()
export class CalendarSkill implements Skill {
  readonly name = 'manage_calendar';
  readonly description =
    "Read and manage the user's calendar (local SQLite + Google Calendar when configured). " +
    'List upcoming events, or create, move, and delete events. Use ISO 8601 for dates/times.';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'create', 'move', 'delete'] },
      source: {
        type: 'string',
        enum: ['local', 'google', 'auto'],
        description: 'Calendar source. auto merges local + Google on list; writes use google if configured.',
      },
      title: { type: 'string', description: 'Event title (create)' },
      start: { type: 'string', description: 'Start date/time, ISO 8601 (create, move)' },
      end: { type: 'string', description: 'Optional end date/time, ISO 8601 (create)' },
      location: { type: 'string', description: 'Optional location (create)' },
      notes: { type: 'string', description: 'Optional notes (create)' },
      id: { type: 'string', description: 'Event id (move, delete)' },
      from: { type: 'string', description: 'Range start for list, ISO 8601. Defaults to now.' },
      to: { type: 'string', description: 'Range end for list, ISO 8601. Defaults to 14 days ahead.' },
    },
    required: ['action'],
  };

  constructor(
    @InjectRepository(CalendarEventEntity)
    private readonly events: Repository<CalendarEventEntity>,
    private readonly googleCalendar: GoogleCalendarService,
  ) {}

  async execute(args: Record<string, unknown>): Promise<SkillResult> {
    const source = String(args?.source ?? 'auto');
    switch (String(args?.action ?? '')) {
      case 'list':
        return this.list(asString(args.from), asString(args.to), source);
      case 'create':
        return this.create(args, source);
      case 'move':
        return this.move(asString(args.id), asString(args.start), source);
      case 'delete':
        return this.delete(asString(args.id), source);
      default:
        return { success: false, output: 'Unknown action. Use list, create, move, or delete.' };
    }
  }

  private useGoogle(source: string): boolean {
    if (source === 'local') {
      return false;
    }
    if (source === 'google') {
      return this.googleCalendar.isConfigured();
    }
    return this.googleCalendar.isConfigured();
  }

  private async list(fromRaw?: string, toRaw?: string, source = 'auto'): Promise<SkillResult> {
    const from = parseDate(fromRaw) ?? new Date();
    const to = parseDate(toRaw) ?? new Date(from.getTime() + 14 * 24 * 3600 * 1000);
    const lines: string[] = [];

    if (source !== 'google') {
      const found = await this.events.find({
        where: { startAt: Between(from, to) },
        order: { startAt: 'ASC' },
        take: 25,
      });
      lines.push(...found.map((e) => `[local:${e.id}] ${formatEvent(e)}`));
    }

    if (this.useGoogle(source)) {
      try {
        const googleEvents = await this.googleCalendar.listEvents(from, to);
        lines.push(
          ...googleEvents.map(
            (e) =>
              `[google:${e.id}] ${e.start}${e.end ? `–${e.end}` : ''} — ${e.title}${e.location ? ` at ${e.location}` : ''}`,
          ),
        );
      } catch (error) {
        lines.push(`Google Calendar error: ${(error as Error).message}`);
      }
    } else if (source === 'google') {
      return {
        success: false,
        output:
          'Google Calendar is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.',
      };
    }

    if (!lines.length) {
      return {
        success: true,
        output: `The calendar is clear between ${from.toDateString()} and ${to.toDateString()}.`,
      };
    }
    return { success: true, output: lines.join('\n') };
  }

  private async create(args: Record<string, unknown>, source: string): Promise<SkillResult> {
    const title = asString(args.title);
    const startRaw = asString(args.start);
    const start = parseDate(startRaw);
    if (!title || !start || !startRaw) {
      return { success: false, output: 'Both "title" and a valid ISO "start" are required.' };
    }

    if (this.useGoogle(source)) {
      try {
        const created = await this.googleCalendar.createEvent({
          title,
          start: startRaw,
          end: asString(args.end),
          location: asString(args.location),
          notes: asString(args.notes),
        });
        return { success: true, output: `Google event created: [google:${created.id}] ${created.title} at ${created.start}` };
      } catch (error) {
        return { success: false, output: `Google Calendar create failed: ${(error as Error).message}` };
      }
    }

    const end = parseDate(asString(args.end));
    const event = await this.events.save(
      this.events.create({
        title,
        startAt: start,
        endAt: end ?? undefined,
        location: asString(args.location) || undefined,
        notes: asString(args.notes) || undefined,
      }),
    );
    return { success: true, output: `Event created: ${formatEvent(event)}` };
  }

  private async move(id?: string, startRaw?: string, source = 'auto'): Promise<SkillResult> {
    const start = parseDate(startRaw);
    if (!id || !start || !startRaw) {
      return { success: false, output: 'Both "id" and a valid new "start" are required to move an event.' };
    }

    if (this.isGoogleTarget(id, source)) {
      const googleId = id.replace(/^google:/, '');
      try {
        const moved = await this.googleCalendar.moveEvent(googleId, startRaw);
        return { success: true, output: `Google event moved: ${moved.title} → ${moved.start}` };
      } catch (error) {
        return { success: false, output: `Google Calendar move failed: ${(error as Error).message}` };
      }
    }

    const event = await this.events.findOne({ where: { id } });
    if (!event) {
      return { success: false, output: `No local event found with id ${id}.` };
    }
    const conflict = await this.findConflict(start, event.id);
    event.startAt = start;
    await this.events.save(event);
    const warning = conflict
      ? ` Note: this overlaps with "${conflict.title}" at ${formatDate(conflict.startAt)}.`
      : '';
    return { success: true, output: `Event moved: ${formatEvent(event)}.${warning}` };
  }

  private async delete(id?: string, source = 'auto'): Promise<SkillResult> {
    if (!id) {
      return { success: false, output: '"id" is required to delete an event.' };
    }

    if (this.isGoogleTarget(id, source)) {
      const googleId = id.replace(/^google:/, '');
      try {
        await this.googleCalendar.deleteEvent(googleId);
        return { success: true, output: `Google event ${googleId} deleted.` };
      } catch (error) {
        return { success: false, output: `Google Calendar delete failed: ${(error as Error).message}` };
      }
    }

    const result = await this.events.delete({ id });
    return result.affected
      ? { success: true, output: `Event ${id} deleted.` }
      : { success: false, output: `No local event found with id ${id}.` };
  }

  private async findConflict(start: Date, excludeId: string): Promise<CalendarEventEntity | null> {
    const nearby = await this.events.find({
      where: { startAt: MoreThanOrEqual(new Date(start.getTime() - 3600 * 1000)) },
      order: { startAt: 'ASC' },
      take: 5,
    });
    return (
      nearby.find(
        (e) => e.id !== excludeId && Math.abs(e.startAt.getTime() - start.getTime()) < 3600 * 1000,
      ) ?? null
    );
  }

  private isGoogleTarget(id: string, source: string): boolean {
    if (id.startsWith('google:')) {
      return true;
    }
    return source === 'google' && this.googleCalendar.isConfigured();
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatEvent(e: CalendarEventEntity): string {
  const end = e.endAt ? ` until ${formatDate(e.endAt)}` : '';
  const location = e.location ? ` at ${e.location}` : '';
  return `[${e.id}] ${formatDate(e.startAt)}${end} — ${e.title}${location}`;
}
