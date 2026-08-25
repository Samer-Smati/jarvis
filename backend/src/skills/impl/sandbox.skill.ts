import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, relative, normalize } from 'node:path';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { Skill, SkillContext, SkillResult } from '../skill.interface';
import { runtimeProfile } from '../permissions';

const execFileAsync = promisify(execFile);

const ALLOWED_COMMANDS = new Set(['node', 'python', 'python3', 'npm', 'npx', 'echo', 'dir', 'ls']);
const NETWORK_BINARIES = new Set(['curl', 'wget', 'fetch', 'powershell', 'cmd', 'bash', 'sh']);

const SANDBOX_ROOT = resolve(process.env.JARVIS_SANDBOX_ROOT ?? 'data/sandbox');

@Injectable()
export class SandboxSkill implements Skill {
  readonly name = 'sandbox_exec';
  readonly description =
    'Run a sandboxed command on desktop only (allowlisted binaries, no shell). Not available on Vercel.';
  readonly requiresConfirmation = true;
  readonly parameters = {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Binary name (node, python, npm, etc.)' },
      args: { type: 'array', items: { type: 'string' }, description: 'Arguments array' },
      cwd: { type: 'string', description: 'Working directory under data/sandbox' },
    },
    required: ['command'],
  };

  async execute(args: Record<string, unknown>, _context: SkillContext): Promise<SkillResult> {
    if (runtimeProfile() === 'vercel') {
      return {
        success: false,
        output: 'Permission denied: sandbox_exec is desktop-only. Cloud JARVIS cannot run local commands.',
      };
    }

    const command = String(args?.command ?? '').trim();
    const rawArgs = Array.isArray(args?.args) ? args.args.map(String) : [];

    if (NETWORK_BINARIES.has(command)) {
      return {
        success: false,
        output: `Permission denied: "${command}" requires network access and is blocked in the sandbox.`,
      };
    }

    if (!ALLOWED_COMMANDS.has(command)) {
      return {
        success: false,
        output: `Permission denied: command "${command}" is not allowlisted. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}.`,
      };
    }

    const pathCheck = validateSandboxPath(String(args?.cwd ?? ''), rawArgs);
    if (!pathCheck.ok) {
      return { success: false, output: pathCheck.reason ?? 'Invalid sandbox path.' };
    }

    if (!existsSync(SANDBOX_ROOT)) {
      return { success: false, output: `Sandbox root missing: ${SANDBOX_ROOT}` };
    }

    try {
      const { stdout, stderr } = await execFileAsync(command, rawArgs, {
        cwd: pathCheck.resolvedCwd,
        timeout: 30_000,
        maxBuffer: 512_000,
        shell: false,
      });
      const output = [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
      return { success: true, output: output.slice(0, 4000) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, output: `Sandbox error: ${message.slice(0, 500)}` };
    }
  }
}

export function validateSandboxPath(
  cwd: string,
  args: string[] = [],
): { ok: boolean; resolvedCwd?: string; reason?: string } {
  const rel = (cwd || '.').replace(/\\/g, '/');
  if (rel.includes('..') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) {
    return { ok: false, reason: 'Permission denied: cwd must be a relative path under data/sandbox (no .. or absolute paths).' };
  }

  for (const arg of args) {
    const normalized = normalize(String(arg)).replace(/\\/g, '/');
    if (normalized.includes('..') || normalized.startsWith('/etc') || /^[a-zA-Z]:\//.test(normalized)) {
      return {
        ok: false,
        reason: `Permission denied: argument "${arg}" escapes the sandbox (path traversal blocked).`,
      };
    }
  }

  const resolvedCwd = resolve(SANDBOX_ROOT, rel);
  const relToRoot = relative(SANDBOX_ROOT, resolvedCwd);
  if (relToRoot.startsWith('..')) {
    return { ok: false, reason: 'Permission denied: cwd resolves outside data/sandbox.' };
  }

  return { ok: true, resolvedCwd };
}
