import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SttService } from './stt.service';
import { TtsService } from './tts.service';

interface AudioUpload {
  buffer: Buffer;
}

interface SynthesizeBody {
  text?: string;
  lang?: string;
}

@Controller('api/voice')
export class VoiceController {
  constructor(
    private readonly stt: SttService,
    private readonly tts: TtsService,
  ) {}

  @Get('tts-status')
  ttsStatus() {
    return this.tts.getStatus();
  }

  @Post('synthesize')
  async synthesize(@Body() body: SynthesizeBody, @Res() res: Response): Promise<void> {
    const text = body?.text?.trim();
    if (!text) {
      throw new BadRequestException('Missing "text".');
    }
    try {
      const wav = await this.tts.synthesize(text);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', String(wav.length));
      res.send(wav);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /** Accepts a WAV recording (multipart field "audio") and returns the transcript. */
  @Post('transcribe')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async transcribe(@UploadedFile() file?: AudioUpload): Promise<{ text: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Missing "audio" file.');
    }
    try {
      return await this.stt.transcribeWav(file.buffer);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
