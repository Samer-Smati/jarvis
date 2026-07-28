import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { redactSensitive } from './feedback-redact.util';
import { InteractionLogEntity } from './entities/interaction-log.entity';

export interface LogInteractionInput {
  conversationId: string;
  prompt: string;
  response: string;
  taskRoute?: string;
  provider?: string;
  toolsUsed?: string[];
  latencyMs?: number;
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @InjectRepository(InteractionLogEntity)
    private readonly logs: Repository<InteractionLogEntity>,
  ) {}

  async logInteraction(input: LogInteractionInput): Promise<InteractionLogEntity> {
    const row = this.logs.create({
      conversationId: input.conversationId,
      prompt: redactSensitive(input.prompt.slice(0, 4000)),
      response: redactSensitive(input.response.slice(0, 8000)),
      taskRoute: input.taskRoute,
      provider: input.provider,
      toolsUsed: input.toolsUsed?.join(', '),
      latencyMs: input.latencyMs,
    });
    return this.logs.save(row);
  }

  async rate(id: string, rating: number, correction?: string): Promise<InteractionLogEntity | null> {
    const row = await this.logs.findOne({ where: { id } });
    if (!row) {
      return null;
    }
    row.rating = Math.max(1, Math.min(5, rating));
    if (correction?.trim()) {
      row.correction = redactSensitive(correction.trim().slice(0, 4000));
    }
    return this.logs.save(row);
  }

  async listForExport(minRating = 4, limit = 2000): Promise<InteractionLogEntity[]> {
    const qb = this.logs
      .createQueryBuilder('log')
      .where('log.rating >= :minRating', { minRating })
      .orderBy('log.createdAt', 'DESC')
      .take(limit);

    if (minRating <= 3) {
      qb.andWhere('log.correction IS NOT NULL');
    }

    return qb.getMany();
  }
}
