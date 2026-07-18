import { Controller, Get } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';

@Controller('api')
export class DiagnosticsController {
  constructor(private readonly llm: LlmService) {}

  @Get('diagnostics')
  async diagnostics() {
    const mem = process.memoryUsage();
    const llmReady = await this.llm.isReady();
    return {
      uptimeSec: Math.round(process.uptime()),
      memoryMb: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
      llmEnsureMode: process.env.JARVIS_LLM_ENSURE ?? 'probe',
      deferPiper: process.env.JARVIS_DEFER_PIPER === '1' || process.env.JARVIS_DEFER_PIPER === 'true',
      whisperModel: process.env.WHISPER_MODEL ?? 'Xenova/whisper-small',
      llmReady: llmReady.ok,
      llmModel: llmReady.model,
      llmError: llmReady.error,
    };
  }
}
