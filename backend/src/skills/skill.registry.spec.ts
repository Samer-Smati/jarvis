import { Skill, SkillResult } from './skill.interface';
import { SkillRegistry } from './skill.registry';

function fakeSkill(name: string, requiresConfirmation = false): Skill {
  return {
    name,
    description: `${name} skill`,
    parameters: { type: 'object', properties: {} },
    requiresConfirmation,
    execute: async (): Promise<SkillResult> => ({ success: true, output: `${name} ran` }),
  };
}

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry([fakeSkill('alpha'), fakeSkill('beta', true)]);
  });

  it('registers and retrieves skills by name', () => {
    expect(registry.get('alpha')?.name).toBe('alpha');
    expect(registry.get('missing')).toBeUndefined();
  });

  it('exposes tool definitions for the LLM', () => {
    const tools = registry.toolDefinitions();
    expect(tools.map((t) => t.name)).toEqual(['alpha', 'beta']);
    expect(tools[0].description).toBe('alpha skill');
  });

  it('excludes disabled skills from tool definitions but keeps them listed', () => {
    registry.setEnabled('alpha', false);
    expect(registry.toolDefinitions().map((t) => t.name)).toEqual(['beta']);
    const listed = registry.list().find((entry) => entry.skill.name === 'alpha');
    expect(listed?.enabled).toBe(false);

    registry.setEnabled('alpha', true);
    expect(registry.toolDefinitions().map((t) => t.name)).toEqual(['alpha', 'beta']);
  });
});
