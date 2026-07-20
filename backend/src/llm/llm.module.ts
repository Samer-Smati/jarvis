import { Global, Module } from '@nestjs/common';
import { ClaudeProvider } from './claude.provider';
import { EmbeddingService } from './embedding.service';
import { EnsureLlmService } from './ensure-llm.service';
import { GroqProvider } from './groq.provider';
import { XaiProvider } from './xai.provider';
import { LlmService } from './llm.service';
import { LLM_PROVIDER } from './llm.types';
import { LmStudioProvider } from './lmstudio.provider';
import { OllamaProvider } from './ollama.provider';

@Global()
@Module({
  providers: [
    OllamaProvider,
    ClaudeProvider,
    GroqProvider,
    XaiProvider,
    LmStudioProvider,
    EmbeddingService,
    EnsureLlmService,
    LlmService,
    { provide: LLM_PROVIDER, useExisting: LlmService },
  ],
  exports: [LLM_PROVIDER, LlmService, EmbeddingService, EnsureLlmService],
})
export class LlmModule {}
