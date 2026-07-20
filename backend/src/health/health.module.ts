import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { DiagnosticsController } from './diagnostics.controller';
import { HealthController } from './health.controller';
import { SpaFallbackController } from './spa-fallback.controller';

const isServerless = !!process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1';

@Module({
  imports: [LlmModule],
  controllers: isServerless
    ? [HealthController, DiagnosticsController]
    : [HealthController, DiagnosticsController, SpaFallbackController],
})
export class HealthModule {}
