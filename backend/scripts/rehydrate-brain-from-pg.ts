/**
 * Manual one-shot: rebuild jarvis/brain/vault.json from Neon brain_pages.
 *
 * Usage (production credentials):
 *   ts-node -r tsconfig-paths/register scripts/rehydrate-brain-from-pg.ts --env=../.env.production.local --confirm
 *
 * Dry run (preview only):
 *   ts-node -r tsconfig-paths/register scripts/rehydrate-brain-from-pg.ts --env=../.env.production.local
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

const envArg = process.argv.find((a) => a.startsWith('--env='));
if (envArg) {
  config({ path: resolve(process.cwd(), envArg.split('=')[1] ?? '') });
} else {
  config();
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BRAIN_REHYDRATE_CONFIRM_PHRASE, BrainService } from '../src/brain/brain.service';

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const minArg = process.argv.find((a) => a.startsWith('--min-pages='));
  const expectedMinPages = minArg ? Number(minArg.split('=')[1]) : 30;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const brain = app.get(BrainService);
    const preview = await brain.previewRehydrateFromPg();
    console.log('Preview:', JSON.stringify(preview, null, 2));

    if (!confirm) {
      console.log(
        `\nDry run only. Re-run with --confirm and env BLOB_READ_WRITE_TOKEN + DATABASE_URL to write blob.`,
      );
      console.log(`Example: --confirm --min-pages=${expectedMinPages}`);
      return;
    }

    const result = await brain.rehydrateFromPg({
      confirm: BRAIN_REHYDRATE_CONFIRM_PHRASE,
      expectedMinPages,
    });
    console.log('Rehydration complete:', JSON.stringify(result, null, 2));

    const verify = await brain.verifyBlobVaultPageCount();
    console.log(`Blob verification: ${verify} pages`);
    if (verify < expectedMinPages) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main();
