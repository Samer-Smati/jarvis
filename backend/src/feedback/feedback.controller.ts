import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { FeedbackService } from './feedback.service';

@Controller('api/feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  log(@Body() body: {
    conversationId?: string;
    prompt: string;
    response: string;
    taskRoute?: string;
    provider?: string;
    toolsUsed?: string[];
    latencyMs?: number;
  }) {
    return this.feedback.logInteraction({
      conversationId: body.conversationId ?? 'default',
      prompt: body.prompt,
      response: body.response,
      taskRoute: body.taskRoute,
      provider: body.provider,
      toolsUsed: body.toolsUsed,
      latencyMs: body.latencyMs,
    });
  }

  @Patch(':id')
  rate(
    @Param('id') id: string,
    @Body() body: { rating: number; correction?: string },
  ) {
    return this.feedback.rate(id, body.rating, body.correction);
  }

  @Get('export')
  export(@Query('minRating') minRating?: string) {
    const min = minRating ? parseInt(minRating, 10) : 4;
    return this.feedback.listForExport(min);
  }
}
