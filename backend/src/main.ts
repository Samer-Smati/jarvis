import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const logger = new Logger('Bootstrap');

async function probeLmStudio(): Promise<boolean> {
  const base = (process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function bootstrap() {
  mkdirSync(dirname(process.env.DATABASE_PATH ?? 'data/jarvis.sqlite'), { recursive: true });
  mkdirSync(process.env.TRANSFORMERS_CACHE ?? 'data/whisper-cache', { recursive: true });

  const llmEnsure = process.env.JARVIS_LLM_ENSURE ?? 'probe';
  const provider = process.env.LLM_PROVIDER ?? 'lmstudio';
  if (provider === 'lmstudio' && llmEnsure === 'full') {
    const ok = await probeLmStudio();
    if (!ok) {
      logger.warn(
        'LM Studio is not reachable on port 1234. Run "npm run boot" from the project root, or: lms server start && lms load qwen/qwen3.5-9b',
      );
    } else {
      logger.log(`Neural core connected (${process.env.LMSTUDIO_CHAT_MODEL ?? 'auto-detect'}).`);
    }
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? ['http://localhost:4200', 'http://localhost:3847'],
  });
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`J.A.R.V.I.S online at http://localhost:${port}`);
}

void bootstrap();
