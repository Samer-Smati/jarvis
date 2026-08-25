import { DeviceControlSkill } from './device-control.skill';

describe('DeviceControlSkill notify_phone', () => {
  it('explains what to configure when NTFY_TOPIC is not set', async () => {
    const permissions = { isGranted: jest.fn().mockResolvedValue(true) } as never;
    const config = { get: () => undefined } as never;
    const skill = new DeviceControlSkill(permissions, config);

    const result = await skill.execute(
      { target: 'phone', action: 'notify_phone', message: 'Hi' },
      { conversationId: 'c1' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('NTFY_TOPIC');
  });
});
