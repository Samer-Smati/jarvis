export interface SkillProgress {
  stage: string;
  message: string;
  percent?: number;
  detail?: string;
}

export interface SkillContext {
  conversationId: string;
  onProgress?: (event: SkillProgress) => void;
}

export interface SkillResult {
  success: boolean;
  output: string;
}

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly requiresConfirmation: boolean;
  execute(args: Record<string, unknown>, context: SkillContext): Promise<SkillResult>;
}

export const SKILLS = Symbol('SKILLS');
