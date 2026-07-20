import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { ConfigService } from '@nestjs/config';

const WRITE_BLOCKED = ['.git', 'node_modules', 'dist', '.jarvis-build.json'];

export function resolveJarvisProjectRoot(config: ConfigService): string {
  const explicit = config.get<string>('JARVIS_PROJECT_ROOT')?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  const candidates = [
    process.cwd(),
    join(process.cwd(), '..'),
    join(process.cwd(), '..', '..'),
    resolve(__dirname, '..', '..', '..', '..'),
  ];

  for (const dir of candidates) {
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) {
      continue;
    }
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name === 'jarvis') {
        return resolve(dir);
      }
    } catch {
      continue;
    }
  }

  return resolve(process.cwd());
}

export function resolveProjectPath(root: string, relative: string): string | null {
  const target = normalize(resolve(join(root, relative || '.')));
  if (target !== root && !target.startsWith(root + sep)) {
    return null;
  }
  return target;
}

export function isWriteBlocked(relative: string): boolean {
  const normalized = relative.replace(/\\/g, '/').replace(/^\.\//, '');
  const lower = normalized.toLowerCase();
  if (lower.endsWith('.env') && !lower.endsWith('.env.example')) {
    return true;
  }
  if (lower.includes('/.env/') || lower.startsWith('.env/')) {
    return true;
  }
  if (/\.(pem|key|p12|pfx)$/i.test(lower)) {
    return true;
  }
  if (/credentials.*\.json$/i.test(lower)) {
    return true;
  }
  for (const segment of WRITE_BLOCKED) {
    if (lower === segment || lower.startsWith(`${segment}/`) || lower.includes(`/${segment}/`)) {
      return true;
    }
  }
  return false;
}

export function isServerlessRuntime(): boolean {
  return !!process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1';
}
