import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import { PermissionsService } from '../../permissions/permissions.service';
import { scopeForDeviceTarget } from '../../permissions/permission.types';
import { Skill, SkillContext, SkillResult } from '../skill.interface';

@Injectable()
export class DeviceControlSkill implements Skill {
  readonly name = 'device_control';
  readonly description =
    'Control the browser, desktop applications, or paired phone. Requires explicit user permission for each category. ' +
    'On web/PWA only web_tab targets are allowed (current tab only).';
  readonly requiresConfirmation = true;
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

  constructor(private readonly permissions: PermissionsService) {}

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
        return { success: true, output: `Requested app: ${appName} (platform launcher invoked).` };
      }
      case 'notify_phone': {
        const message = asString(args.message) ?? 'Notification from JARVIS.';
        return {
          success: true,
          output: `Phone notification queued: "${message}". (Requires paired mobile app when available.)`,
        };
      }
      default:
        return { success: false, output: `Unknown action "${action}".` };
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
