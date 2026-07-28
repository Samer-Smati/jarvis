export type SkillPermissionTier = 'read' | 'write' | 'network' | 'sandbox';

export interface SkillPermission {
  name: string;
  tier: SkillPermissionTier;
  desktopOnly?: boolean;
  requiresEnv?: string[];
}

export const TIER_ORDER: SkillPermissionTier[] = ['read', 'write', 'network', 'sandbox'];

export const SKILL_PERMISSIONS: SkillPermission[] = [
  { name: 'get_current_datetime', tier: 'read' },
  { name: 'web_search', tier: 'network', requiresEnv: ['TAVILY_API_KEY'] },
  { name: 'get_weather', tier: 'network' },
  { name: 'manage_reminders', tier: 'write' },
  { name: 'manage_calendar', tier: 'write' },
  { name: 'read_files', tier: 'read' },
  { name: 'device_control', tier: 'write' },
  { name: 'send_email', tier: 'network', requiresEnv: ['SMTP_HOST'] },
  { name: 'coding_assistant', tier: 'sandbox', desktopOnly: true },
  { name: 'sandbox_exec', tier: 'sandbox', desktopOnly: true },
  { name: 'smart_home', tier: 'network', requiresEnv: ['HOME_ASSISTANT_URL'] },
  { name: 'media_control', tier: 'network' },
  { name: 'brain', tier: 'write' },
  { name: 'self_improve', tier: 'write', requiresEnv: ['GITHUB_TOKEN'] },
  { name: 'propose_persona_change', tier: 'write' },
  { name: 'model_freshness', tier: 'network', desktopOnly: true },
];

export function permissionForSkill(name: string): SkillPermission | undefined {
  return SKILL_PERMISSIONS.find((p) => p.name === name);
}

export function maxSkillTier(): SkillPermissionTier {
  const raw = (process.env.JARVIS_MAX_SKILL_TIER ?? 'sandbox').trim().toLowerCase();
  if (TIER_ORDER.includes(raw as SkillPermissionTier)) {
    return raw as SkillPermissionTier;
  }
  if (runtimeProfile() === 'vercel') {
    return 'network';
  }
  return 'sandbox';
}

export function tierRank(tier: SkillPermissionTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function isTierGranted(required: SkillPermissionTier, granted: SkillPermissionTier): boolean {
  return tierRank(granted) >= tierRank(required);
}

export function tierDenialMessage(skillName: string, required: SkillPermissionTier, granted: SkillPermissionTier): string {
  return (
    `Permission denied: skill "${skillName}" requires ${required} tier but JARVIS_MAX_SKILL_TIER is ${granted}. ` +
    `Raise JARVIS_MAX_SKILL_TIER or use a desktop session with broader permissions.`
  );
}

export function isSkillAllowedOnRuntime(name: string, runtime: 'vercel' | 'desktop'): boolean {
  const perm = permissionForSkill(name);
  if (!perm) {
    return true;
  }
  if (perm.desktopOnly && runtime === 'vercel') {
    return false;
  }
  return true;
}

export function missingEnvForSkill(name: string): string[] {
  const perm = permissionForSkill(name);
  if (!perm?.requiresEnv?.length) {
    return [];
  }
  return perm.requiresEnv.filter((key) => !process.env[key]?.trim());
}

export function runtimeProfile(): 'vercel' | 'desktop' {
  if (process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1') {
    return 'vercel';
  }
  if (process.env.JARVIS_RUNTIME === 'desktop') {
    return 'desktop';
  }
  return process.env.JARVIS_RUNTIME === 'vercel' ? 'vercel' : 'desktop';
}

export function runtimeDenialMessage(skillName: string, runtime: 'vercel' | 'desktop'): string {
  return `Permission denied: skill "${skillName}" is not available on ${runtime} runtime (desktop-only).`;
}
