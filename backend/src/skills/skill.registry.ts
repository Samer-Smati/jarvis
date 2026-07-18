import { Inject, Injectable, Logger } from '@nestjs/common';
import { ToolDefinition } from '../llm/llm.types';
import { Skill, SKILLS } from './skill.interface';

@Injectable()
export class SkillRegistry {
  private readonly logger = new Logger(SkillRegistry.name);
  private readonly skills = new Map<string, Skill>();
  private readonly disabled = new Set<string>();

  constructor(@Inject(SKILLS) skills: Skill[]) {
    for (const skill of skills) {
      this.skills.set(skill.name, skill);
    }
    this.logger.log(`Registered skills: ${[...this.skills.keys()].join(', ')}`);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): { skill: Skill; enabled: boolean }[] {
    return [...this.skills.values()].map((skill) => ({
      skill,
      enabled: !this.disabled.has(skill.name),
    }));
  }

  setEnabled(name: string, enabled: boolean): void {
    if (enabled) {
      this.disabled.delete(name);
    } else {
      this.disabled.add(name);
    }
  }

  toolDefinitions(): ToolDefinition[] {
    return [...this.skills.values()]
      .filter((skill) => !this.disabled.has(skill.name))
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters,
      }));
  }
}
