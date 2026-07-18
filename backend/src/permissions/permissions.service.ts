import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DevicePermissionEntity } from './entities/device-permission.entity';
import {
  PERMISSION_META,
  PermissionGrant,
  PermissionRequest,
  PermissionScope,
} from './permission.types';

interface PendingPermission {
  request: PermissionRequest;
  resolve: (approved: boolean) => void;
}

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);
  private readonly pending = new Map<string, PendingPermission>();

  constructor(
    @InjectRepository(DevicePermissionEntity)
    private readonly repo: Repository<DevicePermissionEntity>,
  ) {}

  async list(platform: 'desktop' | 'web' = 'desktop'): Promise<PermissionGrant[]> {
    const rows = await this.repo.find();
    const map = new Map(rows.map((r) => [r.scope, r]));
    return (Object.keys(PERMISSION_META) as PermissionScope[]).map((scope) => {
      const row = map.get(scope);
      const meta = PERMISSION_META[scope];
      const allowedOnPlatform = platform === 'desktop' || !meta.desktopOnly;
      return {
        scope,
        granted: allowedOnPlatform && !!row?.granted,
        platform: (row?.platform as 'desktop' | 'web') ?? platform,
        label: meta.label,
        description: meta.description,
        updatedAt: row?.updatedAt?.toISOString(),
      };
    });
  }

  async isGranted(scope: PermissionScope, platform: 'desktop' | 'web' = 'desktop'): Promise<boolean> {
    const meta = PERMISSION_META[scope];
    if (platform === 'web' && meta.desktopOnly) {
      return false;
    }
    const row = await this.repo.findOne({ where: { scope } });
    return !!row?.granted;
  }

  async setGranted(scope: PermissionScope, granted: boolean, platform: 'desktop' | 'web'): Promise<void> {
    const meta = PERMISSION_META[scope];
    if (platform === 'web' && meta.desktopOnly && granted) {
      throw new Error(`Scope "${scope}" cannot be granted on web — use the desktop app.`);
    }
    await this.repo.save(
      this.repo.create({
        scope,
        granted,
        platform,
      }),
    );
  }

  requestGrant(
    conversationId: string,
    scope: PermissionScope,
    platform: 'desktop' | 'web',
    notify: (request: PermissionRequest) => void,
  ): Promise<boolean> {
    const meta = PERMISSION_META[scope];
    const request: PermissionRequest = {
      id: randomUUID(),
      conversationId,
      scope,
      title: meta.label,
      message:
        platform === 'web' && meta.desktopOnly
          ? `${meta.label} is not available in the web client. Install the desktop app to grant this permission.`
          : `JARVIS is requesting permission to control: ${meta.label}. ${meta.description} Allow this?`,
    };

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        this.logger.warn(`Permission request ${request.id} timed out — denied.`);
        resolve(false);
      }, PERMISSION_TIMEOUT_MS);

      this.pending.set(request.id, {
        request,
        resolve: (approved) => {
          clearTimeout(timeout);
          this.pending.delete(request.id);
          resolve(approved);
        },
      });
      notify(request);
    });
  }

  async resolveRequest(id: string, approved: boolean, platform: 'desktop' | 'web'): Promise<boolean> {
    const entry = this.pending.get(id);
    if (!entry) {
      return false;
    }
    if (approved) {
      await this.setGranted(entry.request.scope, true, platform);
    }
    entry.resolve(approved);
    return true;
  }

  pendingRequests(): PermissionRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }
}
