import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { ColumnType } from 'typeorm';

/** Load `.env` before entity decorators evaluate column types. */
function loadEnvFileEarly(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), 'backend/.env'),
    resolve(__dirname, '../../.env'),
  ];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const eq = trimmed.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    break;
  }
}

loadEnvFileEarly();

export function isPostgresEnabled(config?: ConfigService): boolean {
  const url = config?.get<string>('DATABASE_URL')?.trim() ?? process.env.DATABASE_URL?.trim();
  return !!url;
}

export function resolveDatabaseUrl(config?: ConfigService): string | undefined {
  return config?.get<string>('DATABASE_URL')?.trim() ?? process.env.DATABASE_URL?.trim();
}

export function isServerlessRuntime(): boolean {
  return !!(process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1');
}

/** Postgres uses `timestamp`; better-sqlite3 / sql.js need `datetime`. */
export function dateTimeColumnType(): ColumnType {
  return resolveDatabaseUrl() ? 'timestamp' : 'datetime';
}
