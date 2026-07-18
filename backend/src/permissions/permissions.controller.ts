import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSION_META, PermissionScope } from './permission.types';
import { PermissionsService } from './permissions.service';

@Controller('api/permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  list(@Query('platform') platform?: string) {
    const p = platform === 'web' ? 'web' : 'desktop';
    return this.permissions.list(p);
  }

  @Post(':scope')
  async setScope(
    @Param('scope') scope: string,
    @Body() body: { granted?: boolean; platform?: string },
  ) {
    if (!(scope in PERMISSION_META)) {
      throw new BadRequestException(`Unknown permission scope "${scope}".`);
    }
    const platform = body?.platform === 'web' ? 'web' : 'desktop';
    try {
      await this.permissions.setGranted(scope as PermissionScope, !!body?.granted, platform);
      return { scope, granted: !!body?.granted, platform };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post('resolve/:id')
  async resolve(
    @Param('id') id: string,
    @Body() body: { approved?: boolean; platform?: string },
  ) {
    const platform = body?.platform === 'web' ? 'web' : 'desktop';
    const ok = await this.permissions.resolveRequest(id, !!body?.approved, platform);
    if (!ok) {
      throw new BadRequestException('Permission request not found or already resolved.');
    }
    return { resolved: true, approved: !!body?.approved };
  }
}
