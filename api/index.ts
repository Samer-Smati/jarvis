type Handler = (req: unknown, res: unknown) => Promise<void>;

let cached: Handler | null = null;

function resolveHandler(mod: unknown): Handler {
  const candidate = mod as { default?: unknown };
  if (typeof candidate === 'function') {
    return candidate as Handler;
  }
  if (typeof candidate.default === 'function') {
    return candidate.default as Handler;
  }
  const nested = candidate.default as { default?: unknown } | undefined;
  if (nested && typeof nested.default === 'function') {
    return nested.default as Handler;
  }
  throw new Error('serverless handler export missing');
}

async function loadHandler(): Promise<Handler> {
  if (cached) {
    return cached;
  }
  const mod = await import('../backend/dist/serverless.js');
  cached = resolveHandler(mod);
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
