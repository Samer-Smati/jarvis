import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface TtsStatus {
  ready: boolean;
  engine: 'piper' | 'none';
  model?: string;
  error?: string;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly voiceName: string;
  private readonly cacheDir: string;
  private piperBin?: string;
  private ensurePiperPromise?: Promise<void>;
  private cachedStatus?: TtsStatus;

  constructor() {
    this.voiceName = process.env.PIPER_VOICE ?? 'en_US-lessac-medium';
    this.cacheDir = path.resolve(process.env.PIPER_CACHE ?? 'data/piper-cache');
  }

  getStatus(): TtsStatus {
    if (this.cachedStatus) {
      return this.cachedStatus;
    }
    this.cachedStatus = this.computeStatus();
    return this.cachedStatus;
  }

  async synthesize(text: string): Promise<Buffer> {
    const cleaned = text?.trim();
    if (!cleaned) {
      throw new Error('Empty text.');
    }

    await this.ensurePiperReady();
    this.cachedStatus = undefined;
    const status = this.getStatus();
    if (!status.ready) {
      throw new Error(status.error ?? 'Piper TTS is not ready.');
    }

    const outFile = path.join(os.tmpdir(), `jarvis-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    const modelPath = this.modelPath();
    const bin = this.getPiperBin();

    try {
      await this.runPiper(bin, cleaned, modelPath, outFile);
      return fs.readFileSync(outFile);
    } finally {
      try {
        if (fs.existsSync(outFile)) {
          fs.unlinkSync(outFile);
        }
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  private computeStatus(): TtsStatus {
    const modelPath = this.modelPath();
    const configPath = `${modelPath}.json`;
    const bin = this.getPiperBin();
    if (!fs.existsSync(bin)) {
      return {
        ready: false,
        engine: 'piper',
        model: this.voiceName,
        error: `Piper binary not found. Voice will download on first use.`,
      };
    }
    if (!fs.existsSync(modelPath)) {
      return {
        ready: false,
        engine: 'piper',
        model: this.voiceName,
        error: `Voice model missing. Will download on first TTS request.`,
      };
    }
    if (!fs.existsSync(configPath) || fs.statSync(configPath).size < 32) {
      return {
        ready: false,
        engine: 'piper',
        model: this.voiceName,
        error: `Voice config invalid. Run ensure-piper to download.`,
      };
    }
    return { ready: true, engine: 'piper', model: this.voiceName };
  }

  private async ensurePiperReady(): Promise<void> {
    if (this.getStatus().ready) {
      return;
    }
    if (!this.ensurePiperPromise) {
      this.ensurePiperPromise = this.runEnsurePiperScript().finally(() => {
        this.ensurePiperPromise = undefined;
        this.cachedStatus = undefined;
        this.piperBin = undefined;
      });
    }
    await this.ensurePiperPromise;
  }

  private runEnsurePiperScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      const candidates = [
        path.resolve(process.cwd(), '..', 'scripts', 'ensure-piper.js'),
        path.resolve(__dirname, '..', '..', '..', 'scripts', 'ensure-piper.js'),
      ];
      const scriptPath = candidates.find((p) => fs.existsSync(p));
      if (!scriptPath) {
        reject(new Error('ensure-piper.js not found'));
        return;
      }
      this.logger.log('Running ensure-piper (deferred first-use download)...');
      const proc = spawn(process.execPath, [scriptPath], {
        env: {
          ...process.env,
          PIPER_CACHE: this.cacheDir,
          PIPER_VOICE: this.voiceName,
          ELECTRON_RUN_AS_NODE: '1',
        },
        windowsHide: true,
        stdio: 'pipe',
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ensure-piper exited with code ${code}`));
        }
      });
    });
  }

  private runPiper(bin: string, text: string, modelPath: string, outFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, ['--model', modelPath, '--output_file', outFile], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.dirname(bin),
      });

      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (error) => reject(error));
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outFile)) {
          resolve();
          return;
        }
        reject(new Error(`Piper failed (code ${code}): ${stderr.trim() || 'unknown error'}`));
      });

      proc.stdin.write(text);
      proc.stdin.end();
    });
  }

  private modelPath(): string {
    return path.join(this.cacheDir, `${this.voiceName}.onnx`);
  }

  private getPiperBin(): string {
    if (this.piperBin) {
      return this.piperBin;
    }
    if (process.env.PIPER_BIN?.trim()) {
      this.piperBin = path.resolve(process.env.PIPER_BIN.trim());
      return this.piperBin;
    }
    const candidates = [
      path.join(this.cacheDir, 'piper', 'piper', 'piper.exe'),
      path.join(this.cacheDir, 'piper', 'piper_windows_amd64', 'piper.exe'),
      path.join(this.cacheDir, 'piper', 'piper.exe'),
      path.join(this.cacheDir, 'piper', 'piper'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.piperBin = candidate;
        return candidate;
      }
    }
    const discovered = this.findPiperExe(path.join(this.cacheDir, 'piper'));
    this.piperBin = discovered ?? (process.platform === 'win32' ? 'piper.exe' : 'piper');
    return this.piperBin;
  }

  private findPiperExe(dir: string): string | null {
    if (!fs.existsSync(dir)) {
      return null;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && (entry.name === 'piper.exe' || entry.name === 'piper')) {
        return full;
      }
      if (entry.isDirectory()) {
        const nested = this.findPiperExe(full);
        if (nested) {
          return nested;
        }
      }
    }
    return null;
  }
}
