import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isPostgresEnabled } from './database.util';

@Injectable()
export class PgInitService implements OnModuleInit {
  private readonly logger = new Logger(PgInitService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!isPostgresEnabled() || this.dataSource.options.type !== 'postgres') {
      return;
    }

    try {
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
      await this.dataSource.query(`
        ALTER TABLE memory_chunks
        ADD COLUMN IF NOT EXISTS embedding vector(768)
      `);
      this.logger.log('PostgreSQL pgvector ready (Neon-compatible).');
    } catch (error) {
      this.logger.warn(`pgvector init skipped: ${(error as Error).message}`);
    }
  }
}
