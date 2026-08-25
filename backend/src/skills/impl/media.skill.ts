import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import { Skill, SkillResult, SkillRiskTier } from '../skill.interface';

const PLAYERCTL_TIMEOUT_MS = 4000;

@Injectable()
export class MediaSkill implements Skill {
  readonly name = 'media_control';
  readonly description =
    'Control whatever is currently playing on this machine via MPRIS (playerctl) -- Spotify, a browser tab, VLC, etc. Linux only.';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['play', 'pause', 'play_pause', 'next', 'previous', 'volume', 'now_playing'],
      },
      volume: { type: 'number', description: 'Volume 0.0-1.0, required for command=volume.' },
    },
    required: ['command'],
  };

  riskFor(args: Record<string, unknown>): SkillRiskTier {
    // Reading what's playing is inert; transport controls are fully reversible.
    return String(args?.command ?? '') === 'now_playing' ? 'low' : 'medium';
  }

  async execute(args: Record<string, unknown>): Promise<SkillResult> {
    if (process.platform !== 'linux') {
      return { success: false, output: 'Media control currently supports Linux (via playerctl) only.' };
    }

    const command = String(args?.command ?? '');
    switch (command) {
      case 'now_playing':
        return this.runPlayerctl(['metadata', '--format', '{{ artist }} - {{ title }} ({{ status }})']);
      case 'play':
        return this.runPlayerctl(['play']);
      case 'pause':
        return this.runPlayerctl(['pause']);
      case 'play_pause':
        return this.runPlayerctl(['play-pause']);
      case 'next':
        return this.runPlayerctl(['next']);
      case 'previous':
        return this.runPlayerctl(['previous']);
      case 'volume': {
        const volume = Number(args?.volume);
        if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
          return { success: false, output: '"volume" must be a number between 0.0 and 1.0.' };
        }
        return this.runPlayerctl(['volume', String(volume)]);
      }
      default:
        return { success: false, output: `Unknown command "${command}".` };
    }
  }

  private async runPlayerctl(args: string[]): Promise<SkillResult> {
    try {
      const output = await runCommand('playerctl', args, PLAYERCTL_TIMEOUT_MS);
      return { success: true, output: output.trim() || 'Done.' };
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('ENOENT')) {
        return {
          success: false,
          output:
            'playerctl is not installed, so I cannot control media. Install it (e.g. `sudo apt install playerctl`) and try again.',
        };
      }
      if (message.includes('No players found')) {
        return { success: false, output: 'No media player is currently running.' };
      }
      return { success: false, output: `Media control failed: ${message}` };
    }
  }
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(new Error(stderr.trim() || `exit code ${code}`));
      }
    });
  });
}
