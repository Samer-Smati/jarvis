import { Controller, Get } from '@nestjs/common';
import { BrainService } from '../brain/brain.service';
import { PersonalityService } from '../orchestrator/personality.service';

@Controller('api/persona')
export class PersonaController {
  constructor(
    private readonly personality: PersonalityService,
    private readonly brain: BrainService,
  ) {}

  @Get('compare')
  async compare() {
    const draftPath = this.personality.getDraftPath();
    const pages = await this.brain.listPages();
    const draftPage = pages.find((p) => p.path === draftPath);
    return this.personality.compareDraftVsActive(draftPage?.content ?? '');
  }

  @Get('active')
  active() {
    return { prompt: this.personality.getActivePrompt().slice(0, 4000) };
  }
}
