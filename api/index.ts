type Handler = (req: unknown, res: unknown) => Promise<void>;

let cached: Handler | null = null;

async function loadHandler(): Promise<Handler> {
  if (cached) {
    return cached;
  }
  const mod = await import('../backend/dist/serverless.js');
  cached = mod.default as Handler;
  return cached;
}

export default async function handler(req: unknown, res: { status?: (code: number) => { json: (body: unknown) => void } }) {
  try {
    const app = await loadHandler();
    await app(req, res);
  } catch (error) {
    console.error('[jarvis] api bootstrap failed:', error);
    res.status?.(500)?.json?.({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
