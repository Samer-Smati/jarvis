import { Injectable } from '@nestjs/common';
import { Skill, SkillResult } from '../skill.interface';

@Injectable()
export class DatetimeSkill implements Skill {
  readonly name = 'get_current_datetime';
  readonly description = 'Get the current date and time, optionally in a given IANA timezone.';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone, e.g. "Europe/Paris". Defaults to server timezone.',
      },
    },
  };

  async execute(args: Record<string, unknown>): Promise<SkillResult> {
    const timezone = typeof args?.timezone === 'string' ? args.timezone : undefined;
    try {
      const formatted = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: timezone,
      }).format(new Date());
      return { success: true, output: formatted };
    } catch {
      return { success: false, output: `Unknown timezone: ${timezone}` };
    }
  }
}
