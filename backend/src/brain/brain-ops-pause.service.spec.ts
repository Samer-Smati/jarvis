import { BrainOpsPauseService } from './brain-ops-pause.service';
import { MemoryRepository } from '../memory/memory.repository';
import { BRAIN_OPS_BLOCKED_MESSAGE } from './brain-ops.util';

describe('BrainOpsPauseService', () => {
  let service: BrainOpsPauseService;
  let prefs: Map<string, string>;

  beforeEach(() => {
    prefs = new Map();
    const memoryRepo = {
      getPreferenceValue: jest.fn(async (key: string) => (prefs.has(key) ? prefs.get(key)! : null)),
      upsertPreference: jest.fn(async (key: string, value: string) => {
        prefs.set(key, value);
      }),
    } as unknown as MemoryRepository;
    service = new BrainOpsPauseService(memoryRepo);
  });

  it('defaults to paused when preference is missing', async () => {
    const status = await service.status();
    expect(status.paused).toBe(true);
  });

  it('resume clears pause and pause sets it again', async () => {
    await service.resume();
    expect((await service.status()).paused).toBe(false);
    await service.pause('User halt');
    const status = await service.status();
    expect(status.paused).toBe(true);
    expect(status.reason).toBe('User halt');
    expect(status.since).toBeTruthy();
  });

  it('blocks mutating actions while paused', async () => {
    await service.pause('test');
    await expect(service.assertMutationAllowed('cleanup')).rejects.toThrow(BRAIN_OPS_BLOCKED_MESSAGE);
    await expect(service.assertMutationAllowed('consolidate')).rejects.toThrow(BRAIN_OPS_BLOCKED_MESSAGE);
    await service.resume();
    await expect(service.assertMutationAllowed('cleanup')).resolves.toBeUndefined();
  });

  it('allows non-mutating actions while paused', async () => {
    await service.pause('test');
    await expect(service.assertMutationAllowed('graph')).resolves.toBeUndefined();
  });
});
