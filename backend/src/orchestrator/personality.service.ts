import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { JARVIS_SYSTEM_PROMPT } from './personality';

interface PersonaManifest {
  activeVersion: string;
  versions: Record<string, { file: string; approvedAt?: string; approvedBy?: string }>;
  draftPath?: string;
}

@Injectable()
export class PersonalityService {
  private readonly logger = new Logger(PersonalityService.name);
  private readonly root = process.env.JARVIS_ROOT ?? join(process.cwd(), '..');
  private cachedPrompt: string | null = null;

  getActivePrompt(): string {
    if (this.cachedPrompt) {
      return this.cachedPrompt;
    }

    const manifestPath = join(this.root, 'personality', 'manifest.json');
    if (!existsSync(manifestPath)) {
      return JARVIS_SYSTEM_PROMPT;
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PersonaManifest;
      const version = manifest.versions[manifest.activeVersion];
      if (!version?.file) {
        return JARVIS_SYSTEM_PROMPT;
      }
      const filePath = join(this.root, version.file);
      if (!existsSync(filePath)) {
        return JARVIS_SYSTEM_PROMPT;
      }
      const md = readFileSync(filePath, 'utf8').trim();
      this.cachedPrompt = `${JARVIS_SYSTEM_PROMPT}\n\n--- Approved persona (${manifest.activeVersion}) ---\n${md}`;
      return this.cachedPrompt;
    } catch (error) {
      this.logger.warn(`Persona load failed: ${(error as Error).message}`);
      return JARVIS_SYSTEM_PROMPT;
    }
  }

  getDraftPath(): string {
    const manifestPath = join(this.root, 'personality', 'manifest.json');
    if (!existsSync(manifestPath)) {
      return 'Persona/Draft';
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PersonaManifest;
    return manifest.draftPath ?? 'Persona/Draft';
  }

  compareDraftVsActive(draftContent: string): { active: string; draft: string; changed: boolean } {
    const active = this.getActivePrompt();
    return {
      active: active.slice(0, 4000),
      draft: draftContent.slice(0, 4000),
      changed: draftContent.trim() !== active.trim(),
    };
  }

  invalidateCache(): void {
    this.cachedPrompt = null;
  }
}
