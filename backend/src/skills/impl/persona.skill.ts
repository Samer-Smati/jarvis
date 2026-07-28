import { Injectable } from '@nestjs/common';
import { BrainService } from '../../brain/brain.service';
import { PersonalityService } from '../../orchestrator/personality.service';
import { Skill, SkillContext, SkillResult } from '../skill.interface';

@Injectable()
export class PersonaSkill implements Skill {
  readonly name = 'propose_persona_change';
  readonly description =
    'Stage a personality change as a brain draft page. Does NOT apply live — user must review and merge via PR.';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'draft', 'compare'] },
      content: { type: 'string', description: 'Draft persona markdown (for action=draft)' },
    },
    required: ['action'],
  };

  constructor(
    private readonly brain: BrainService,
    private readonly personality: PersonalityService,
  ) {}

  async execute(args: Record<string, unknown>, _context: SkillContext): Promise<SkillResult> {
    const action = String(args?.action ?? 'status');
    const draftPath = this.personality.getDraftPath();

    if (action === 'status') {
      return {
        success: true,
        output: `Active persona loaded. Draft path: ${draftPath}. Changes require PR review — never auto-applied.`,
      };
    }

    if (action === 'compare') {
      const pages = await this.brain.listPages();
      const draftPage = pages.find((p) => p.path === draftPath);
      const draftContent = draftPage?.content ?? '';
      const diff = this.personality.compareDraftVsActive(draftContent);
      return {
        success: true,
        output: diff.changed
          ? `Draft differs from active persona. Review ${draftPath} before opening a PR.`
          : 'Draft matches active persona.',
      };
    }

    const content = String(args?.content ?? '').trim();
    if (!content) {
      return { success: false, output: 'content is required for action=draft.' };
    }

    await this.brain.remember('Persona Draft', content, 'session');
    return {
      success: true,
      output: `Draft saved to brain page "${draftPath}". Review in UI, then use self_improve to open a PR updating personality/base.md and manifest.json. Live persona unchanged until merge.`,
    };
  }
}
