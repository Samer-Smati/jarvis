import { Injectable, Logger } from '@nestjs/common';

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string } | { text: string }[]>;

const UNLOAD_IDLE_MS = 10 * 60 * 1000;

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);
  private transcriberPromise?: Promise<Transcriber>;
  private unloadTimer?: ReturnType<typeof setTimeout>;

  get modelId(): string {
    if (process.env.WHISPER_MODEL?.trim()) {
      return process.env.WHISPER_MODEL.trim();
    }
    const perf = process.env.JARVIS_PERFORMANCE_MODE === '1' || process.env.JARVIS_PERFORMANCE_MODE === 'true';
    return perf ? 'Xenova/whisper-tiny' : 'Xenova/whisper-small';
  }

  async transcribeWav(wav: Buffer): Promise<{ text: string }> {
    const audio = decodeWavToMono16k(wav);
    const transcriber = await this.getTranscriber();
    this.scheduleUnload();
    const started = Date.now();
    const result = await transcriber(audio, {
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = (Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text).trim();
    this.logger.log(
      `Transcribed ${(audio.length / 16000).toFixed(1)}s of audio in ${Date.now() - started}ms: "${text.slice(0, 80)}"`,
    );
    return { text };
  }

  private scheduleUnload(): void {
    if (this.unloadTimer) {
      clearTimeout(this.unloadTimer);
    }
    this.unloadTimer = setTimeout(() => {
      this.logger.log('Unloading Whisper model after idle timeout.');
      this.transcriberPromise = undefined;
    }, UNLOAD_IDLE_MS);
  }

  private getTranscriber(): Promise<Transcriber> {
    if (!this.transcriberPromise) {
      this.transcriberPromise = (async () => {
        const cacheDir = process.env.TRANSFORMERS_CACHE ?? 'data/whisper-cache';
        process.env.TRANSFORMERS_CACHE = cacheDir;
        this.logger.log(`Loading Whisper model "${this.modelId}" (first run downloads it)...`);
        const { pipeline } = await import('@huggingface/transformers');
        const pipe = await pipeline('automatic-speech-recognition', this.modelId);
        this.logger.log('Whisper model ready.');
        return pipe as unknown as Transcriber;
      })();
      this.transcriberPromise.catch((error) => {
        this.logger.error(`Failed to load Whisper: ${(error as Error).message}`);
        this.transcriberPromise = undefined;
      });
    }
    return this.transcriberPromise;
  }
}

function decodeWavToMono16k(buffer: Buffer): Float32Array {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Expected a 16-bit PCM WAV file.');
  }
  let offset = 12;
  let sampleRate = 16000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataStart = offset + 8;
      dataLength = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataStart < 0 || bitsPerSample !== 16) {
    throw new Error('Expected a 16-bit PCM WAV file.');
  }

  const sampleCount = Math.floor(dataLength / 2 / channels);
  const mono = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += buffer.readInt16LE(dataStart + (i * channels + c) * 2);
    }
    mono[i] = sum / channels / 32768;
  }
  if (sampleRate === 16000) {
    return mono;
  }

  const targetLength = Math.floor((mono.length * 16000) / sampleRate);
  const resampled = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const src = (i * sampleRate) / 16000;
    const low = Math.floor(src);
    const high = Math.min(low + 1, mono.length - 1);
    resampled[i] = mono[low] + (mono[high] - mono[low]) * (src - low);
  }
  return resampled;
}
