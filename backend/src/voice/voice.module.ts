import { Module } from '@nestjs/common';
import { SttService } from './stt.service';
import { TtsService } from './tts.service';
import { VoiceController } from './voice.controller';

@Module({
  controllers: [VoiceController],
  providers: [SttService, TtsService],
  exports: [SttService, TtsService],
})
export class VoiceModule {}
