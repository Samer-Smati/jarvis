import { Global, Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { PersonalityService } from './personality.service';
import { PersonaController } from './persona.controller';

@Global()
@Module({
  controllers: [PersonaController],
  providers: [OrchestratorService, PersonalityService],
  exports: [OrchestratorService, PersonalityService],
})
export class OrchestratorModule {}
