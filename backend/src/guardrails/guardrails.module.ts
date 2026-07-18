import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';
import { GuardrailService } from './guardrail.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity])],
  providers: [GuardrailService],
  exports: [GuardrailService],
})
export class GuardrailsModule {}
