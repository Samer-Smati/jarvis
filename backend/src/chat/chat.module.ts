import { Module } from '@nestjs/common';
import { SkillsModule } from '../skills/skills.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatSseController } from './chat-sse.controller';

const isServerless = !!process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1';

@Module({
  imports: [SkillsModule],
  controllers: [ChatController, ChatSseController],
  providers: isServerless ? [] : [ChatGateway],
  exports: isServerless ? [] : [ChatGateway],
})
export class ChatModule {}