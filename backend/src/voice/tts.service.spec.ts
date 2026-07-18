import * as fs from 'fs';
import * as path from 'path';
import { TtsService } from './tts.service';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

describe('TtsService', () => {
  const cacheDir = path.join(process.cwd(), 'data', 'piper-cache-test');
  const voice = 'en_GB-alan-medium';

  beforeEach(() => {
    process.env.PIPER_CACHE = cacheDir;
    process.env.PIPER_VOICE = voice;
    delete process.env.PIPER_BIN;
    fs.mkdirSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('reports not ready when binary and model are missing', () => {
    const service = new TtsService();
    const status = service.getStatus();
    expect(status.ready).toBe(false);
    expect(status.engine).toBe('piper');
    expect(status.error).toMatch(/Piper binary|Voice model/);
  });

  it('reports ready when binary and model exist', () => {
    const binDir = path.join(cacheDir, 'piper');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'piper.exe'), '');
    fs.writeFileSync(path.join(cacheDir, `${voice}.onnx`), 'model');
    fs.writeFileSync(
      path.join(cacheDir, `${voice}.onnx.json`),
      JSON.stringify({ audio: { sample_rate: 22050 }, espeak: { voice: 'en-gb' } }),
    );

    const service = new TtsService();
    expect(service.getStatus()).toEqual({
      ready: true,
      engine: 'piper',
      model: voice,
    });
  });
});
