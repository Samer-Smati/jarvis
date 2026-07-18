import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Skill, SkillContext, SkillResult } from '../skill.interface';

const RUNTIME_MS = 15000;
const MAX_OUTPUT = 8000;

@Injectable()
export class CodingSkill implements Skill {
  readonly name = 'coding_assistant';
  readonly description =
    'Run code in a sandbox, explain snippets, or answer questions about files under the scoped project folder.';
  readonly requiresConfirmation = true;
  readonly parameters = {
    type: 'object',
    properties: {
      task: { type: 'string', enum: ['generate', 'debug', 'explain', 'review', 'run'] },
      instructions: { type: 'string' },
      language: { type: 'string', enum: ['javascript', 'typescript', 'python', 'shell'] },
      code: { type: 'string', description: 'Code to run (task=run/debug)' },
      file_path: { type: 'string', description: 'Relative path under sandbox to read/explain' },
    },
    required: ['task', 'instructions'],
  };

  private readonly root: string;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('SANDBOX_ROOT') ?? config.get<string>('FILES_ROOT') ?? 'data/sandbox');
    this.enabled = config.get<string>('SANDBOX_ENABLED') !== 'false';
  }

  async execute(args: Record<string, unknown>, _context: SkillContext): Promise<SkillResult> {
    const task = String(args?.task ?? '');
    const instructions = asString(args.instructions);
    if (!instructions) {
      return { success: false, output: '"instructions" is required.' };
    }

    if (task === 'run' || task === 'debug') {
      if (!this.enabled) {
        return { success: false, output: 'Coding sandbox is disabled. Set SANDBOX_ENABLED=true in backend/.env.' };
      }
      const code = asString(args.code);
      if (!code) {
        return { success: false, output: '"code" is required for run/debug tasks.' };
      }
      const language = String(args.language ?? 'javascript');
      const output = await this.runSandbox(code, language);
      return { success: true, output: `Sandbox (${language}):\n${output}` };
    }

    if (task === 'explain' || task === 'review') {
      const rel = asString(args.file_path);
      if (!rel) {
        return {
          success: true,
          output:
            `Task "${task}" for: ${instructions}. No file_path given — use read_files or provide a path under the sandbox.`,
        };
      }
      const target = resolve(join(this.root, rel));
      if (target !== this.root && !target.startsWith(this.root + sep)) {
        return { success: false, output: 'Access denied: path escapes the sandbox.' };
      }
      try {
        const content = await fs.readFile(target, 'utf8');
        const snippet = content.length > 4000 ? `${content.slice(0, 4000)}\n...[truncated]` : content;
        return {
          success: true,
          output: `File ${rel} (${task} request: ${instructions}):\n\`\`\`\n${snippet}\n\`\`\``,
        };
      } catch (error) {
        return { success: false, output: `Could not read file: ${(error as Error).message}` };
      }
    }

    return {
      success: true,
      output: `Coding task "${task}" noted: ${instructions}. Use the conversation to generate code; use task=run with code to execute in sandbox.`,
    };
  }

  private async runSandbox(code: string, language: string): Promise<string> {
    await fs.mkdir(this.root, { recursive: true });
    const stamp = Date.now();
    let command: string;
    let args: string[];
    let cwd = this.root;

    switch (language) {
      case 'python':
        command = 'python';
        args = ['-c', code];
        break;
      case 'shell':
        command = process.platform === 'win32' ? 'powershell' : 'bash';
        args = process.platform === 'win32' ? ['-NoProfile', '-Command', code] : ['-lc', code];
        break;
      case 'typescript': {
        const file = join(this.root, `run-${stamp}.ts`);
        await fs.writeFile(file, code, 'utf8');
        command = 'npx';
        args = ['tsx', file];
        break;
      }
      default: {
        const file = join(this.root, `run-${stamp}.js`);
        await fs.writeFile(file, code, 'utf8');
        command = 'node';
        args = [file];
        break;
      }
    }

    return new Promise((resolvePromise) => {
      let stdout = '';
      let stderr = '';
      const proc = spawn(command, args, { cwd, windowsHide: true, timeout: RUNTIME_MS });
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on('error', (error) => resolvePromise(`Process error: ${error.message}`));
      proc.on('close', (code) => {
        const combined = [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
        const trimmed = combined.length > MAX_OUTPUT ? `${combined.slice(0, MAX_OUTPUT)}\n...[truncated]` : combined;
        resolvePromise(`exit ${code ?? '?'}\n${trimmed}`);
      });
    });
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
