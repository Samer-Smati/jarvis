import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Skill, SkillResult } from '../skill.interface';

@Injectable()
export class FilesystemSkill implements Skill {
  readonly name = 'read_files';
  readonly description =
    'List or read files inside the assistant\'s scoped data folder (read-only, sandboxed).';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'read'] },
      path: { type: 'string', description: 'Relative path inside the scoped folder. Defaults to root.' },
    },
    required: ['action'],
  };

  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('FILES_ROOT') ?? 'data/files');
  }

  async execute(args: Record<string, unknown>): Promise<SkillResult> {
    const action = String(args?.action ?? '');
    const relative = typeof args?.path === 'string' ? args.path : '.';
    const target = resolve(join(this.root, relative));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      return { success: false, output: 'Access denied: path escapes the scoped folder.' };
    }

    try {
      await fs.mkdir(this.root, { recursive: true });
      switch (action) {
        case 'list': {
          const entries = await fs.readdir(target, { withFileTypes: true });
          if (!entries.length) {
            return { success: true, output: 'Folder is empty.' };
          }
          const lines = entries.map((e) => `${e.isDirectory() ? '[dir] ' : ''}${e.name}`);
          return { success: true, output: lines.join('\n') };
        }
        case 'read': {
          const content = await fs.readFile(target, 'utf8');
          const truncated = content.length > 8000 ? `${content.slice(0, 8000)}\n...[truncated]` : content;
          return { success: true, output: truncated };
        }
        default:
          return { success: false, output: `Unknown action "${action}". Use list or read.` };
      }
    } catch (error) {
      return { success: false, output: `Filesystem error: ${(error as Error).message}` };
    }
  }
}
