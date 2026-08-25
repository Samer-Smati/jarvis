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

export type SkillRiskTier = 'low' | 'medium' | 'high';

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly requiresConfirmation: boolean;
  /**
   * Optional per-action risk classification. When present, this replaces
   * `requiresConfirmation` for gating decisions: 'high' blocks on user
   * confirmation like today, 'medium' auto-approves but is logged/surfaced
   * as a trusted action, 'low' auto-approves silently. Skills without this
   * fall back to `requiresConfirmation ? 'high' : 'low'`.
   */
  riskFor?(args: Record<string, unknown>): SkillRiskTier;
  execute(args: Record<string, unknown>, context: SkillContext): Promise<SkillResult>;
}

export const SKILLS = Symbol('SKILLS');
