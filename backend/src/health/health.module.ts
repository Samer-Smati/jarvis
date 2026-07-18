import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { DiagnosticsController } from './diagnostics.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [LlmModule],
  controllers: [HealthController, DiagnosticsController],
})
export class HealthModule {}
