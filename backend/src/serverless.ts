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
      process.env.LLM_PROVIDER =
        process.env.LLM_PROVIDER ?? (process.env.XAI_API_KEY ? 'xai' : 'groq');
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
