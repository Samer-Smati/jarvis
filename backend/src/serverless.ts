import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';

const server = express();
let ready: Promise<express.Express> | null = null;

function bootstrap(): Promise<express.Express> {
  if (!ready) {
    ready = (async () => {
      process.env.VERCEL = process.env.VERCEL ?? '1';
      process.env.JARVIS_SERVERLESS = '1';
      process.env.JARVIS_LLM_ENSURE = 'off';
      if (!process.env.JARVIS_BACKEND_ROOT) {
        const { existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        for (const root of [join(process.cwd(), 'backend'), join(__dirname, '..')]) {
          if (existsSync(join(root, 'dist', 'serverless.js'))) {
            process.env.JARVIS_BACKEND_ROOT = root;
            break;
          }
        }
      }
      if (!process.env.LLM_PROVIDER) {
        if (process.env.GROQ_API_KEY) {
          process.env.LLM_PROVIDER = 'groq';
        } else if (process.env.XAI_API_KEY) {
          process.env.LLM_PROVIDER = 'xai';
        } else {
          process.env.LLM_PROVIDER = 'groq';
        }
      }
      process.env.GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant';
      process.env.DATABASE_PATH = process.env.DATABASE_PATH ?? '/tmp/jarvis.sqlite';

      const nest = await NestFactory.create(AppModule, new ExpressAdapter(server), {
        logger: ['error', 'warn', 'log'],
      });
      nest.enableCors({ origin: true, credentials: true });
      await nest.init();
      return server;
    })();
  }
  return ready;
}

export default async function handler(req: express.Request, res: express.Response) {
  try {
    const app = await bootstrap();
    app(req, res);
  } catch (error) {
    console.error('[jarvis] serverless bootstrap failed:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
