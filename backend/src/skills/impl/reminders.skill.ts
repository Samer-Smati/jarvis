import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReminderEntity } from '../entities/reminder.entity';
import { Skill, SkillResult } from '../skill.interface';

@Injectable()
export class RemindersSkill implements Skill {
  readonly name = 'manage_reminders';
  readonly description =
    'Create, list, or delete reminders. Reminders fire proactively when due. ' +
    'Use ISO 8601 for "due_at" (e.g. "2026-07-14T18:30:00").';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'delete'] },
      text: { type: 'string', description: 'Reminder text (for create)' },
      due_at: { type: 'string', description: 'ISO 8601 due date/time (for create)' },
      id: { type: 'string', description: 'Reminder id (for delete)' },
    },
    required: ['action'],
  };

  constructor(
    @InjectRepository(ReminderEntity)
    private readonly reminders: Repository<ReminderEntity>,
  ) {}

  async execute(args: Record<string, unknown>): Promise<SkillResult> {
    const action = String(args?.action ?? '');
    switch (action) {
      case 'create':
        return this.create(String(args?.text ?? ''), String(args?.due_at ?? ''));
      case 'list':
        return this.list();
      case 'delete':
        return this.delete(String(args?.id ?? ''));
      default:
        return { success: false, output: `Unknown action "${action}". Use create, list, or delete.` };
    }
  }

  private async create(text: string, dueAtRaw: string): Promise<SkillResult> {
    if (!text || !dueAtRaw) {
      return { success: false, output: 'Both "text" and "due_at" are required to create a reminder.' };
    }
    const dueAt = new Date(dueAtRaw);
    if (Number.isNaN(dueAt.getTime())) {
      return { success: false, output: `Invalid date: ${dueAtRaw}` };
    }
    const reminder = await this.reminders.save(this.reminders.create({ text, dueAt }));
    return {
      success: true,
      output: `Reminder created (id ${reminder.id}): "${text}" at ${dueAt.toISOString()}`,
    };
  }

  private async list(): Promise<SkillResult> {
    const all = await this.reminders.find({
      where: { fired: false },
      order: { dueAt: 'ASC' },
    });
    if (!all.length) {
      return { success: true, output: 'No pending reminders.' };
    }
    const lines = all.map((r) => `- [${r.id}] ${r.text} — due ${r.dueAt.toISOString()}`);
    return { success: true, output: lines.join('\n') };
  }

  private async delete(id: string): Promise<SkillResult> {
    if (!id) {
      return { success: false, output: '"id" is required to delete a reminder.' };
    }
    const result = await this.reminders.delete({ id });
    return result.affected
      ? { success: true, output: `Reminder ${id} deleted.` }
      : { success: false, output: `No reminder found with id ${id}.` };
  }
}
