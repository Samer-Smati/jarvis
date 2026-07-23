import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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
import { BrainModule } from './brain/brain.module';
import { PermissionsModule } from './permissions/permissions.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SkillsModule } from './skills/skills.module';
import { VoiceModule } from './voice/voice.module';
import { HealthModule } from './health/health.module';
import { isServerlessRuntime, resolveDatabaseUrl } from './database/database.util';

const publicPath = process.env.FRONTEND_PATH ?? join(__dirname, '..', 'public');
const isServerless = isServerlessRuntime();
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

function resolveSqlJsWasmBinary(): Buffer {
  const candidates = [
    join(__dirname, '..', 'node_modules', 'sql.js', 'dist'),
    process.env.JARVIS_BACKEND_ROOT
      ? join(process.env.JARVIS_BACKEND_ROOT, 'node_modules', 'sql.js', 'dist')
      : '',
    join(process.cwd(), 'backend', 'node_modules', 'sql.js', 'dist'),
    join(process.cwd(), 'node_modules', 'sql.js', 'dist'),
  ].filter(Boolean);

  for (const dir of candidates) {
    const wasmPath = join(dir, 'sql-wasm.wasm');
    if (existsSync(wasmPath)) {
      return readFileSync(wasmPath);
    }
  }

  throw new Error(`sql.js WASM not found. Checked: ${candidates.join(', ')}`);
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...staticModules,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = resolveDatabaseUrl(config);
        if (databaseUrl) {
          return {
            type: 'postgres' as const,
            url: databaseUrl,
            ssl:
              databaseUrl.includes('neon.tech') || databaseUrl.includes('sslmode=require')
                ? { rejectUnauthorized: false }
                : undefined,
            autoLoadEntities: true,
            synchronize: true,
            extra: isServerless ? { max: 3, idleTimeoutMillis: 10_000 } : undefined,
          };
        }
        if (isServerless) {
          const dbPath = process.env.DATABASE_PATH ?? '/tmp/jarvis.sqlite';
          mkdirSync(dirname(dbPath), { recursive: true });
          return {
            type: 'sqljs' as const,
            location: dbPath,
            autoSave: true,
            autoLoadEntities: true,
            synchronize: true,
            sqlJsConfig: {
              wasmBinary: resolveSqlJsWasmBinary(),
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
    BrainModule,
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
