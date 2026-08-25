import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { InteractionLogEntity } from '../feedback/entities/interaction-log.entity';
import { LessonEntity } from '../lessons/entities/lesson.entity';
import { isServerlessRuntime, resolveDatabaseUrl } from './database.util';

function resolveSqlJsWasmBinary(): Buffer {
  const candidates = [
    join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist'),
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

function resolveSqliteDatabasePath(): string {
  const raw = process.env.DATABASE_PATH?.trim() || 'data/jarvis.sqlite';
  if (raw.startsWith('/') || /^[A-Za-z]:[/\\]/.test(raw)) {
    return raw;
  }

  const candidates = [
    join(process.cwd(), raw),
    join(process.cwd(), 'backend', raw),
    join(__dirname, '..', '..', raw),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return join(process.cwd(), 'backend', raw);
}

export function buildScriptDataSourceOptions(): DataSourceOptions {
  const entities = [LessonEntity, InteractionLogEntity];
  const databaseUrl = resolveDatabaseUrl();

  if (databaseUrl) {
    return {
      type: 'postgres',
      url: databaseUrl,
      ssl:
        databaseUrl.includes('neon.tech') || databaseUrl.includes('sslmode=require')
          ? { rejectUnauthorized: false }
          : undefined,
      entities,
      synchronize: false,
    };
  }

  if (isServerlessRuntime()) {
    const dbPath = process.env.DATABASE_PATH ?? '/tmp/jarvis.sqlite';
    mkdirSync(dirname(dbPath), { recursive: true });
    return {
      type: 'sqljs',
      location: dbPath,
      autoSave: false,
      entities,
      synchronize: false,
      sqlJsConfig: {
        wasmBinary: resolveSqlJsWasmBinary(),
      },
    };
  }

  const database = resolveSqliteDatabasePath();
  mkdirSync(dirname(database), { recursive: true });
  return {
    type: 'better-sqlite3',
    database,
    entities,
    synchronize: false,
  };
}

export async function createScriptDataSource(): Promise<DataSource> {
  const dataSource = new DataSource(buildScriptDataSourceOptions());
  await dataSource.initialize();
  return dataSource;
}
