import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InteractionLogEntity } from '../feedback/entities/interaction-log.entity';
import { LessonsService } from './lessons.service';

@Controller('api/lessons')
export class LessonsController {
  constructor(
    private readonly lessons: LessonsService,
    @InjectRepository(InteractionLogEntity)
    private readonly interactions: Repository<InteractionLogEntity>,
  ) {}

  @Get()
  async list() {
    const rows = await this.lessons.listForReview();
    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      grouped[row.taskType] = grouped[row.taskType] ?? [];
      grouped[row.taskType].push(row);
    }
    return { lessons: rows, grouped };
  }

  @Post('prune-dry-run')
  async pruneDryRun(@Body() body?: { days?: number }) {
    const candidates = await this.lessons.pruneDryRun(body?.days ?? 30);
    return { count: candidates.length, candidates };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const lesson = await this.lessons.getById(id);
    if (!lesson) {
      return { lesson: null };
    }
    let source: InteractionLogEntity | null = null;
    if (lesson.sourceInteractionId) {
      source = await this.interactions.findOne({ where: { id: lesson.sourceInteractionId } });
    }
    return {
      lesson,
      source: source
        ? {
            id: source.id,
            prompt: source.prompt,
            response: source.response,
            correction: source.correction,
            createdAt: source.createdAt,
          }
        : null,
    };
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { lessonText: string }) {
    return this.lessons.updateText(id, body?.lessonText ?? '');
  }

  @Patch(':id/pin')
  pin(@Param('id') id: string, @Body() body: { pinned: boolean }) {
    return this.lessons.pin(id, !!body?.pinned);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.lessons.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) {
    return this.lessons.reject(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.lessons.archive(id);
  }
}
