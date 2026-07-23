import type { ConfigService } from '@nestjs/config';

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
