import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PermissionsService } from '../../permissions/permissions.service';
import { scopeForDeviceTarget } from '../../permissions/permission.types';
import { Skill, SkillContext, SkillResult, SkillRiskTier } from '../skill.interface';

@Injectable()
export class DeviceControlSkill implements Skill {
  readonly name = 'device_control';
  readonly description =
    'Control the browser, desktop applications, or paired phone. Requires explicit user permission for each category. ' +
    'On web/PWA only web_tab targets are allowed (current tab only).';
  // The orchestrator already gates every call behind a per-target permission scope
  // (asked once, remembered) before this tier is consulted -- a second blocking
  // confirmation on top of that would just be double-gating an already-trusted action.
  readonly requiresConfirmation = false;

  riskFor(): SkillRiskTier {
    return 'medium';
  }
  readonly parameters = {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        enum: ['browser', 'pc_app', 'phone', 'web_tab'],
        description: 'What to control: browser, pc_app, phone, or web_tab (web client only).',
      },
      action: {
        type: 'string',
        enum: ['open_url', 'launch_app', 'focus_app', 'notify_phone'],
      },
      url: { type: 'string', description: 'URL for open_url (browser or web_tab).' },
      app_name: { type: 'string', description: 'Application name or path for launch_app / focus_app.' },
      message: { type: 'string', description: 'Message for notify_phone.' },
      platform: {
        type: 'string',
        enum: ['desktop', 'web'],
        description: 'Client platform making the request.',
      },
    },
    required: ['target', 'action'],
  };

  constructor(
    private readonly permissions: PermissionsService,
    private readonly config: ConfigService,
  ) {}

  async execute(args: Record<string, unknown>, _context: SkillContext): Promise<SkillResult> {
    const target = String(args?.target ?? '');
    const action = String(args?.action ?? '');
    const platform = args?.platform === 'web' ? 'web' : 'desktop';
    const scope = scopeForDeviceTarget(target);

    if (!scope) {
      return { success: false, output: 'Unknown target. Use browser, pc_app, phone, or web_tab.' };
    }

    const granted = await this.permissions.isGranted(scope, platform);
    if (!granted) {
      return {
        success: false,
        output:
          `Permission for "${scope}" is not granted. Ask the user to approve in Settings → Device permissions, ` +
          `or approve the on-screen permission prompt when JARVIS requests access.`,
      };
    }

    switch (action) {
      case 'open_url': {
        const url = asString(args.url);
        if (!url) {
          return { success: false, output: '"url" is required for open_url.' };
        }
        if (target === 'web_tab') {
          return {
            success: true,
            output: `WEB_TAB: Navigate this JARVIS tab to ${url}. (Handled by the frontend — in-tab only.)`,
          };
        }
        if (target === 'browser') {
          await openExternal(url);
          return { success: true, output: `Opened in default browser: ${url}` };
        }
        return { success: false, output: 'open_url requires target browser or web_tab.' };
      }
      case 'launch_app':
      case 'focus_app': {
        if (platform === 'web') {
          return {
            success: false,
            output: 'PC application control is not available on web. Use the JARVIS desktop app.',
          };
        }
        const appName = asString(args.app_name);
        if (!appName) {
          return { success: false, output: '"app_name" is required.' };
        }
        if (process.platform === 'win32') {
          spawn('cmd', ['/c', 'start', '', appName], { detached: true, stdio: 'ignore', windowsHide: true });
          return { success: true, output: `Launched/focused application: ${appName}` };
        }
        if (process.platform === 'darwin') {
          return macOpenApp(appName);
        }
        return action === 'launch_app' ? launchLinuxApp(appName) : focusLinuxApp(appName);
      }
      case 'notify_phone': {
        const message = asString(args.message) ?? 'Notification from JARVIS.';
        return this.notifyPhone(message);
      }
      default:
        return { success: false, output: `Unknown action "${action}".` };
    }
  }

  private async notifyPhone(message: string): Promise<SkillResult> {
    const topic = this.config.get<string>('NTFY_TOPIC');
    if (!topic) {
      return {
        success: false,
        output:
          'Phone notifications are not configured. Set NTFY_TOPIC (and optionally NTFY_URL for a self-hosted ' +
          `server) in backend/.env, then install the ntfy app and subscribe to that topic. Draft: "${message}"`,
      };
    }
    const baseUrl = (this.config.get<string>('NTFY_URL') ?? 'https://ntfy.sh').replace(/\/$/, '');
    try {
      const res = await fetch(`${baseUrl}/${topic}`, {
        method: 'POST',
        body: message,
        headers: { Title: 'JARVIS' },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { success: false, output: `Phone notification failed (${res.status}): ${text.slice(0, 300)}` };
      }
      return { success: true, output: `Phone notification sent: "${message}".` };
    } catch (error) {
      return { success: false, output: `Phone notification failed: ${(error as Error).message}` };
    }
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function openExternal(url: string): Promise<void> {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args =
    process.platform === 'win32' ? ['/c', 'start', '', url] : process.platform === 'darwin' ? [url] : [url];
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, { windowsHide: true, timeout: 4000 });
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(stderr.trim() || `exit code ${code}`));
      }
    });
  });
}

function macOpenApp(appName: string): Promise<SkillResult> {
  return runCommand('open', ['-a', appName])
    .then<SkillResult>(() => ({ success: true, output: `Launched/focused application: ${appName}` }))
    .catch<SkillResult>((error: Error) => ({ success: false, output: `Could not open "${appName}": ${error.message}` }));
}

function launchLinuxApp(appName: string): Promise<SkillResult> {
  return new Promise((resolvePromise) => {
    const proc = spawn(appName, [], { detached: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      proc.unref();
      resolvePromise({ success: true, output: `Launched application: ${appName}` });
    }, 300);
    proc.once('error', (error: Error) => {
      clearTimeout(timer);
      resolvePromise({
        success: false,
        output: `Could not launch "${appName}": ${error.message}. Check the binary name is correct and on PATH.`,
      });
    });
  });
}

function focusLinuxApp(appName: string): Promise<SkillResult> {
  return runCommand('wmctrl', ['-a', appName])
    .then<SkillResult>(() => ({ success: true, output: `Focused window matching "${appName}".` }))
    .catch<SkillResult>((wmctrlError: Error) => {
      if (!wmctrlError.message.includes('ENOENT')) {
        return { success: false, output: `Could not focus "${appName}": ${wmctrlError.message}` };
      }
      return runCommand('xdotool', ['search', '--name', appName, 'windowactivate'])
        .then<SkillResult>(() => ({ success: true, output: `Focused window matching "${appName}".` }))
        .catch<SkillResult>((xdotoolError: Error) => {
          if (xdotoolError.message.includes('ENOENT')) {
            return {
              success: false,
              output:
                "Neither wmctrl nor xdotool is installed, so I can't focus windows. " +
                'Install one (e.g. `sudo apt install wmctrl`) and try again.',
            };
          }
          return { success: false, output: `Could not focus "${appName}": ${xdotoolError.message}` };
        });
    });
}
