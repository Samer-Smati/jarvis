import { Body, Controller, Get, Post } from '@nestjs/common';
import { HoloService } from './holo.service';
import type { HoloFolder, HoloStateReport } from './holo.types';

interface HoloStateBody {
  event?: unknown;
  card?: unknown;
}

/**
 * Backs the gesture deck served from /holo. Route shapes mirror the reference deck's
 * standalone server so holo.html stays portable; only the base path is namespaced.
 */
@Controller('api/holo')
export class HoloController {
  constructor(private readonly holo: HoloService) {}

  @Get('tree')
  tree(): Promise<HoloFolder[]> {
    return this.holo.tree();
  }

  @Get('props')
  props(): string[] {
    return this.holo.listProps();
  }

  @Get('state')
  state(): { state: HoloStateReport | null } {
    return { state: this.holo.lastReport };
  }

  @Post('state')
  async postState(@Body() body: HoloStateBody): Promise<{ ok: true }> {
    const event = typeof body?.event === 'string' ? body.event.slice(0, 40) : 'unknown';
    const card = typeof body?.card === 'string' ? body.card.slice(0, 120) : undefined;
    await this.holo.recordState(event, card);
    return { ok: true };
  }

  @Post('diag')
  async postDiag(@Body() body: Record<string, unknown>): Promise<{ ok: true }> {
    await this.holo.recordDiag(body ?? {});
    return { ok: true };
  }
}
