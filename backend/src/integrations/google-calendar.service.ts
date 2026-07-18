import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GoogleCalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private readonly calendarId: string;

  constructor(private readonly config: ConfigService) {
    this.calendarId = this.config.get<string>('GOOGLE_CALENDAR_ID') ?? 'primary';
  }

  isConfigured(): boolean {
    return !!(
      this.config.get<string>('GOOGLE_CLIENT_ID')?.trim() &&
      this.config.get<string>('GOOGLE_CLIENT_SECRET')?.trim() &&
      this.config.get<string>('GOOGLE_REFRESH_TOKEN')?.trim()
    );
  }

  async listEvents(from: Date, to: Date): Promise<GoogleCalendarEvent[]> {
    if (!this.isConfigured()) {
      return [];
    }
    const calendar = await this.clientAsync();
    const res = await calendar.events.list({
      calendarId: this.calendarId,
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 25,
    });
    return (res.data.items ?? []).map((item) => ({
      id: item.id ?? '',
      title: item.summary ?? '(no title)',
      start: item.start?.dateTime ?? item.start?.date ?? '',
      end: item.end?.dateTime ?? item.end?.date ?? undefined,
      location: item.location ?? undefined,
    }));
  }

  async createEvent(input: {
    title: string;
    start: string;
    end?: string;
    location?: string;
    notes?: string;
  }): Promise<GoogleCalendarEvent> {
    const calendar = await this.requireClient();
    const res = await calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: {
        summary: input.title,
        location: input.location,
        description: input.notes,
        start: toGoogleDate(input.start),
        end: toGoogleDate(input.end ?? input.start),
      },
    });
    const item = res.data;
    return {
      id: item.id ?? '',
      title: item.summary ?? input.title,
      start: item.start?.dateTime ?? item.start?.date ?? input.start,
      end: item.end?.dateTime ?? item.end?.date ?? undefined,
      location: item.location ?? undefined,
    };
  }

  async moveEvent(id: string, start: string): Promise<GoogleCalendarEvent> {
    const calendar = await this.requireClient();
    const existing = await calendar.events.get({ calendarId: this.calendarId, eventId: id });
    const res = await calendar.events.patch({
      calendarId: this.calendarId,
      eventId: id,
      requestBody: {
        start: toGoogleDate(start),
        end: existing.data.end,
      },
    });
    const item = res.data;
    return {
      id: item.id ?? id,
      title: item.summary ?? '',
      start: item.start?.dateTime ?? item.start?.date ?? start,
      end: item.end?.dateTime ?? item.end?.date ?? undefined,
      location: item.location ?? undefined,
    };
  }

  async deleteEvent(id: string): Promise<void> {
    const calendar = await this.requireClient();
    await calendar.events.delete({ calendarId: this.calendarId, eventId: id });
  }

  private async clientAsync() {
    const { google } = await import('googleapis');
    const oauth2 = new google.auth.OAuth2(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
    );
    oauth2.setCredentials({
      refresh_token: this.config.get<string>('GOOGLE_REFRESH_TOKEN'),
    });
    return google.calendar({ version: 'v3', auth: oauth2 });
  }

  private async requireClient() {
    const calendar = await this.clientAsync();
    if (!calendar) {
      throw new Error(
        'Google Calendar is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in backend/.env',
      );
    }
    return calendar;
  }
}

function toGoogleDate(iso: string): { dateTime?: string; date?: string; timeZone?: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { date: iso };
  }
  return { dateTime: iso };
}
