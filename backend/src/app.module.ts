import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
const isServerless = !!process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1';
const staticModules =
  !isServerless && existsSync(publicPath)
    ? [
        ServeStaticModule.forRoot({
          rootPath: publicPath,
          exclude: ['/api/(.*)', '/socket.io/(.*)'],
        }),
      ]
    : [];

const scheduleModules = isServerless ? [] : [ScheduleModule.forRoot(), SchedulerModule];
const voiceModules = isServerless ? [] : [VoiceModule];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...staticModules,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (isServerless) {
          const dbPath = process.env.DATABASE_PATH ?? '/tmp/jarvis.sqlite';
          mkdirSync(dirname(dbPath), { recursive: true });
          const wasmDir = join(process.cwd(), 'node_modules', 'sql.js', 'dist');
          return {
            type: 'sqljs' as const,
            location: dbPath,
            autoSave: true,
            autoLoadEntities: true,
            synchronize: true,
            sqlJsConfig: {
              locateFile: (file: string) =>
                existsSync(join(wasmDir, file))
                  ? join(wasmDir, file)
                  : `https://sql.js.org/dist/${file}`,
            },
          };
        }
        return {
          type: 'better-sqlite3' as const,
          database: config.get<string>('DATABASE_PATH') ?? 'data/jarvis.sqlite',
          autoLoadEntities: true,
          synchronize: true,
        };
      },
    }),
    ...scheduleModules,
    LlmModule,
    MemoryModule,
    GuardrailsModule,
    PermissionsModule,
    SkillsModule,
    IntegrationsModule,
    OrchestratorModule,
    ChatModule,
    ...voiceModules,
    HealthModule,
  ],
})
export class AppModule {}
