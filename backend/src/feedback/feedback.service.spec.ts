import { FeedbackService } from './feedback.service';
import { LessonsService } from '../lessons/lessons.service';
import { InteractionLogEntity } from './entities/interaction-log.entity';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let logs: { findOne: jest.Mock; save: jest.Mock };
  let lessons: { extractFromInteraction: jest.Mock };

  beforeEach(() => {
    logs = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    lessons = {
      extractFromInteraction: jest.fn().mockResolvedValue(undefined),
    };
    service = new FeedbackService(logs as never, lessons as unknown as LessonsService);
  });

  it('triggers async lesson extraction on low rating', async () => {
    const row = { id: 'i1', rating: 2, correction: null } as unknown as InteractionLogEntity;
    logs.findOne.mockResolvedValue(row);
    logs.save.mockResolvedValue({ ...row, rating: 2 });

    await service.rate('i1', 2);

    expect(lessons.extractFromInteraction).toHaveBeenCalledWith('i1');
  });

  it('triggers extraction when correction is present', async () => {
    const row = { id: 'i2', rating: 4, correction: null } as unknown as InteractionLogEntity;
    logs.findOne.mockResolvedValue(row);
    logs.save.mockResolvedValue({ ...row, rating: 4, correction: 'Use weekly report' });

    await service.rate('i2', 4, 'Use weekly report');

    expect(lessons.extractFromInteraction).toHaveBeenCalledWith('i2');
  });

  it('does not block save when extraction throws', async () => {
    const row = { id: 'i3', rating: 1 } as unknown as InteractionLogEntity;
    logs.findOne.mockResolvedValue(row);
    logs.save.mockResolvedValue(row);
    lessons.extractFromInteraction.mockRejectedValue(new Error('boom'));

    const saved = await service.rate('i3', 1);
    expect(saved?.id).toBe('i3');
    await new Promise((r) => setTimeout(r, 10));
  });
});
