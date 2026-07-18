import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from './chat/chat.module';
import { GuardrailsModule } from './guardrails/guardrails.module';
import { LlmModule } from './llm/llm.module';
import { MemoryModule } from './memory/memory.module';
import { PermissionsModule } from './permissions/permissions.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SkillsModule } from './skills/skills.module';
import { VoiceModule } from './voice/voice.module';
import { HealthModule } from './health/health.module';

const publicPath = process.env.FRONTEND_PATH ?? join(__dirname, '..', 'public');
const staticModules = existsSync(publicPath)
  ? [
      ServeStaticModule.forRoot({
        rootPath: publicPath,
        exclude: ['/api*', '/socket.io*'],
      }),
    ]
  : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...staticModules,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'better-sqlite3',
        database: config.get<string>('DATABASE_PATH') ?? 'data/jarvis.sqlite',
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),
    ScheduleModule.forRoot(),
    LlmModule,
    MemoryModule,
    GuardrailsModule,
    PermissionsModule,
    SkillsModule,
    IntegrationsModule,
    OrchestratorModule,
    ChatModule,
    SchedulerModule,
    VoiceModule,
    HealthModule,
  ],
})
export class AppModule {}
