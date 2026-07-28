import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { MemoryService } from './memory.service';
import type { CreateProjectInput, MemoryType } from './memory.types';

@Controller('api/memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Get('facts')
  listFacts() {
    return this.memory.listFacts();
  }

  @Get('preferences')
  listPreferences() {
    return this.memory.listPreferences();
  }

  @Get('projects')
  listProjects() {
    return this.memory.listProjects();
  }

  @Post('facts')
  createFact(@Body() body: { text: string; memoryType?: MemoryType; source?: string }) {
    return this.memory.rememberTyped({
      text: body.text,
      memoryType: body.memoryType ?? 'fact',
      source: body.source ?? 'api',
    });
  }

  @Post('projects')
  createProject(@Body() body: CreateProjectInput) {
    return this.memory.rememberProject(body);
  }

  @Patch('facts/:id/pin')
  pinFact(@Param('id') id: string, @Body() body: { pinned: boolean }) {
    return this.memory.pinFact(id, !!body?.pinned);
  }

  @Delete('facts/:id')
  forgetFact(@Param('id') id: string) {
    return this.memory.forgetFact(id);
  }

  @Delete('preferences/:id')
  forgetPreference(@Param('id') id: string) {
    return this.memory.forgetPreference(id);
  }

  @Delete('projects/:id')
  forgetProject(@Param('id') id: string) {
    return this.memory.forgetProject(id);
  }

  @Post('prune')
  pruneStale(@Body() body?: { maxAgeDays?: number }) {
    return this.memory.pruneStaleMemories(body?.maxAgeDays ?? 90).then((pruned) => ({ ok: true, pruned }));
  }
}
