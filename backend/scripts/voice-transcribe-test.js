/** POST a silence WAV to /api/voice/transcribe */
const fs = require('fs');
const path = require('path');
const http = require('http');

const wavPath = path.join(process.env.TEMP || '/tmp', 'jarvis-test.wav');

function makeWav() {
  const sampleRate = 16000;
  const numSamples = sampleRate;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(wavPath, buffer);
}

makeWav();
const body = fs.readFileSync(wavPath);
const boundary = '----jarvis' + Date.now();
const header = `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`;
const footer = `\r\n--${boundary}--\r\n`;
const payload = Buffer.concat([Buffer.from(header), body, Buffer.from(footer)]);

const started = Date.now();
const req = http.request(
  {
    hostname: 'localhost',
    port: 3000,
    path: '/api/voice/transcribe',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
    },
    timeout: 180000,
  },
  (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      console.log('HTTP:', res.statusCode);
      console.log('ELAPSED:', ((Date.now() - started) / 1000).toFixed(1) + 's');
      console.log('BODY:', data);
      process.exit(res.statusCode === 200 || res.statusCode === 201 ? 0 : 1);
    });
  },
);
req.on('error', (e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
req.write(payload);
req.end();
