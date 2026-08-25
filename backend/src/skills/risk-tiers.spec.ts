import { CalendarSkill } from './impl/calendar.skill';
import { CodingSkill } from './impl/coding.skill';
import { DeviceControlSkill } from './impl/device-control.skill';
import { SelfImproveSkill } from './impl/self-improve.skill';
import { SmartHomeSkill } from './impl/smart-home.skill';

const configStub = { get: () => undefined } as never;

describe('per-skill riskFor tiers', () => {
  it('CalendarSkill: only delete/move are high risk', () => {
    const skill = new CalendarSkill({} as never, {} as never);
    expect(skill.riskFor?.({ action: 'list' })).toBe('low');
    expect(skill.riskFor?.({ action: 'create' })).toBe('low');
    expect(skill.riskFor?.({ action: 'move' })).toBe('high');
    expect(skill.riskFor?.({ action: 'delete' })).toBe('high');
  });

  it('CodingSkill: sandboxed run/debug/review/explain are medium, everything else low', () => {
    const skill = new CodingSkill(configStub);
    expect(skill.riskFor?.({ task: 'run' })).toBe('medium');
    expect(skill.riskFor?.({ task: 'debug' })).toBe('medium');
    expect(skill.riskFor?.({ task: 'review' })).toBe('medium');
    expect(skill.riskFor?.({ task: 'explain' })).toBe('medium');
    expect(skill.riskFor?.({ task: 'generate' })).toBe('low');
  });

  it('SelfImproveSkill: only pull_request is high risk', () => {
    const skill = new SelfImproveSkill(configStub, {} as never, {} as never);
    expect(skill.riskFor?.({ action: 'status' })).toBe('low');
    expect(skill.riskFor?.({ action: 'inspect' })).toBe('low');
    expect(skill.riskFor?.({ action: 'verify_responsive' })).toBe('low');
    expect(skill.riskFor?.({ action: 'write' })).toBe('medium');
    expect(skill.riskFor?.({ action: 'commit' })).toBe('medium');
    expect(skill.riskFor?.({ action: 'apply_preset' })).toBe('medium');
    expect(skill.riskFor?.({ action: 'run_checks' })).toBe('medium');
    expect(skill.riskFor?.({ action: 'pull_request' })).toBe('high');
  });

  it('SmartHomeSkill: always medium (permission scope is the trust gate)', () => {
    const skill = new SmartHomeSkill(configStub);
    expect(skill.riskFor?.()).toBe('medium');
  });

  it('DeviceControlSkill: always medium (permission scope is the trust gate)', () => {
    const skill = new DeviceControlSkill({} as never, configStub);
    expect(skill.riskFor?.()).toBe('medium');
  });
});
