import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClaudeProvider } from './claude.provider';
import { CloudflareProvider } from './cloudflare.provider';
import { EmbeddingService } from './embedding.service';
import { EnsureLlmService } from './ensure-llm.service';
import { LlmSettingEntity } from './entities/llm-setting.entity';
import { GroqProvider } from './groq.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { XaiProvider } from './xai.provider';
import { LlmService } from './llm.service';
import { LLM_PROVIDER } from './llm.types';
import { LmStudioProvider } from './lmstudio.provider';
import { OllamaProvider } from './ollama.provider';
import { TaskRouterService } from './task-router.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([LlmSettingEntity])],
  providers: [
    OllamaProvider,
    ClaudeProvider,
    GroqProvider,
    GeminiProvider,
    OpenRouterProvider,
    XaiProvider,
    CloudflareProvider,
    LmStudioProvider,
    EmbeddingService,
    EnsureLlmService,
    TaskRouterService,
    LlmService,
    { provide: LLM_PROVIDER, useExisting: LlmService },
  ],
  exports: [LLM_PROVIDER, LlmService, EmbeddingService, EnsureLlmService, TaskRouterService],
})
export class LlmModule {}
