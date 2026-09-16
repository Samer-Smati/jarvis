import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { HoloService } from './holo.service';
import type { HoloFolder, HoloSource, HoloStateReport, HoloWorkspaceGroup } from './holo.types';

const SOURCES: HoloSource[] = ['brain', 'projects', 'tasks', 'memories', 'events', 'calendar', 'all'];

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

  /**
   * The spatial workspace for one JARVIS source — what `SHOW_PROJECTS` and its
   * siblings resolve to. An unrecognised source falls back to the brain vault
   * rather than erroring: the deck should always have something to show.
   */
  @Get('workspace')
  workspace(@Query('source') source?: string): Promise<HoloWorkspaceGroup[]> {
    const wanted = SOURCES.includes(source as HoloSource) ? (source as HoloSource) : 'brain';
    return this.holo.workspace(wanted);
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
