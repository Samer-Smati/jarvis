import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Skill, SkillContext, SkillResult } from '../skill.interface';

@Injectable()
export class SmartHomeSkill implements Skill {
  readonly name = 'smart_home';
  readonly description =
    'Control smart-home devices via Home Assistant (lights, switches, climate, scripts).';
  readonly requiresConfirmation = true;
  readonly parameters = {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Home Assistant domain, e.g. light, switch, climate, script',
      },
      service: { type: 'string', description: 'Service name, e.g. turn_on, turn_off, set_temperature' },
      entity_id: { type: 'string', description: 'Entity id, e.g. light.living_room' },
      data: {
        type: 'object',
        description: 'Optional extra service data (brightness, temperature, etc.)',
      },
    },
    required: ['domain', 'service', 'entity_id'],
  };

  constructor(private readonly config: ConfigService) {}

  async execute(args: Record<string, unknown>, _context: SkillContext): Promise<SkillResult> {
    const domain = asString(args.domain);
    const service = asString(args.service);
    const entityId = asString(args.entity_id);
    if (!domain || !service || !entityId) {
      return { success: false, output: '"domain", "service", and "entity_id" are required.' };
    }

    const baseUrl = this.config.get<string>('HOME_ASSISTANT_URL')?.replace(/\/$/, '');
    const token = this.config.get<string>('HOME_ASSISTANT_TOKEN');
    if (!baseUrl || !token) {
      return {
        success: false,
        output:
          'Home Assistant is not configured. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN in backend/.env.',
      };
    }

    const extra = args.data && typeof args.data === 'object' ? (args.data as Record<string, unknown>) : {};
    const body = { entity_id: entityId, ...extra };

    try {
      const res = await fetch(`${baseUrl}/api/services/${domain}/${service}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        return { success: false, output: `Home Assistant error ${res.status}: ${text.slice(0, 500)}` };
      }
      const json = (await res.json()) as unknown[];
      const count = Array.isArray(json) ? json.length : 0;
      return {
        success: true,
        output: `Called ${domain}.${service} on ${entityId} (${count} entity update(s)).`,
      };
    } catch (error) {
      return { success: false, output: `Home Assistant request failed: ${(error as Error).message}` };
    }
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
