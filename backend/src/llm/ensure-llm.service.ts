import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { LmStudioProvider } from './lmstudio.provider';
import { OllamaProvider } from './ollama.provider';

const execFileAsync = promisify(execFile);

export interface EnsureLlmResult {
  ok: boolean;
  provider?: 'lmstudio' | 'ollama';
  model?: string;
  error?: string;
}

@Injectable()
export class EnsureLlmService {
  private readonly logger = new Logger(EnsureLlmService.name);
  private readonly preferredLmStudio: string;
  private readonly preferredOllama: string;
  private inFlight: Promise<EnsureLlmResult> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly lmstudio: LmStudioProvider,
    private readonly ollama: OllamaProvider,
  ) {
    this.preferredLmStudio = config.get<string>('LMSTUDIO_CHAT_MODEL') ?? 'qwen/qwen3.5-9b';
    this.preferredOllama = config.get<string>('OLLAMA_CHAT_MODEL') ?? 'llama3.2';
  }

  /** Probe local runtimes and start a default model if nothing is online. */
  ensureReady(preferredProvider?: string): Promise<EnsureLlmResult> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.ensureReadyInternal(preferredProvider).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async ensureReadyInternal(preferredProvider?: string): Promise<EnsureLlmResult> {
    const mode = process.env.JARVIS_LLM_ENSURE ?? 'probe';
    if (mode === 'off') {
      return { ok: false, error: 'LLM ensure is disabled (JARVIS_LLM_ENSURE=off).' };
    }

    const order =
      preferredProvider === 'ollama'
        ? (['ollama', 'lmstudio'] as const)
        : (['lmstudio', 'ollama'] as const);

    if (mode === 'probe') {
      for (const provider of order) {
        const ready =
          provider === 'lmstudio' ? await this.lmstudio.isReady() : await this.ollama.isReady();
        if (ready.ok) {
          return { ok: true, provider, model: ready.model };
        }
      }
      return {
        ok: false,
        error: 'No local LLM detected. Start LM Studio or Ollama manually (probe mode).',
      };
    }

    for (const provider of order) {
      if (provider === 'lmstudio') {
        const ready = await this.lmstudio.isReady();
        if (ready.ok) {
          return { ok: true, provider: 'lmstudio', model: ready.model };
        }
        const started = await this.startLmStudio();
        if (started.ok) {
          return started;
        }
        this.logger.warn(`LM Studio ensure failed: ${started.error}`);
        continue;
      }

      const ready = await this.ollama.isReady();
      if (ready.ok) {
        return { ok: true, provider: 'ollama', model: ready.model };
      }
      const started = await this.startOllama();
      if (started.ok) {
        return started;
      }
      this.logger.warn(`Ollama ensure failed: ${started.error}`);
    }

    return {
      ok: false,
      error:
        'No local LLM is available. Install/start LM Studio (lms server start && lms load qwen/qwen3.5-9b) or Ollama (ollama serve).',
    };
  }

  private async startLmStudio(): Promise<EnsureLlmResult> {
    if (!(await this.hasCommand('lms'))) {
      return { ok: false, error: 'LM Studio CLI (lms) not found' };
    }

    this.logger.log('Starting LM Studio server...');
    await this.runCommand('lms', ['server', 'start']);

    let ready = await this.waitFor(() => this.lmstudio.isReady(), 20_000, 2000);
    if (!ready?.ok) {
      this.logger.log(`Loading default LM Studio model: ${this.preferredLmStudio}`);
      await this.runCommand('lms', ['load', this.preferredLmStudio]);
      ready = await this.waitFor(() => this.lmstudio.isReady(), 120_000, 2500);
    }

    if (!ready?.ok) {
      return { ok: false, error: ready?.error ?? 'LM Studio did not become ready' };
    }

    const model = ready.model ?? this.preferredLmStudio;
    this.lmstudio.setPreferredModel(model);
    this.logger.log(`LM Studio ready — ${model}`);
    return { ok: true, provider: 'lmstudio', model };
  }

  private async startOllama(): Promise<EnsureLlmResult> {
    const ollamaBin = process.env.OLLAMA_BIN?.trim() || 'ollama';
    const hasBin =
      ollamaBin.includes('/') || ollamaBin.includes('\\')
        ? existsSync(ollamaBin)
        : await this.hasCommand(ollamaBin);
    if (!hasBin) {
      return { ok: false, error: 'Ollama CLI not found' };
    }

    this.logger.log('Starting Ollama...');
    const env = { ...process.env };
    if (process.env.OLLAMA_MODELS) {
      env.OLLAMA_MODELS = process.env.OLLAMA_MODELS;
    }
    void this.runCommand(ollamaBin, ['serve'], env).catch(() => undefined);
    await this.sleep(4000);

    const ready = await this.waitFor(() => this.ollama.isReady(), 30_000, 2000);
    if (!ready?.ok) {
      return { ok: false, error: ready?.error ?? 'Ollama did not become ready' };
    }
    return { ok: true, provider: 'ollama', model: ready.model ?? this.preferredOllama };
  }

  private async waitFor(
    probe: () => Promise<{ ok: boolean; model?: string; error?: string }>,
    maxMs: number,
    intervalMs: number,
  ): Promise<{ ok: boolean; model?: string; error?: string } | null> {
    const started = Date.now();
    let last: { ok: boolean; model?: string; error?: string } | null = null;
    while (Date.now() - started < maxMs) {
      last = await probe();
      if (last.ok) {
        return last;
      }
      await this.sleep(intervalMs);
    }
    return last;
  }

  private async hasCommand(name: string): Promise<boolean> {
    try {
      const check = process.platform === 'win32' ? 'where' : 'which';
      await execFileAsync(check, [name], { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }

  private async runCommand(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 2 * 1024 * 1024,
        env: env ?? process.env,
      });
      return `${stdout ?? ''}${stderr ?? ''}`;
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      this.logger.warn(`Command failed: ${command} ${args.join(' ')} — ${err.message}`);
      return `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
