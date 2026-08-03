import { FACTORY_RESET_CONFIRM_PHRASE } from './factory-reset.service';

describe('factory-reset confirm phrase', () => {
  it('requires the fixed NEWBORN confirmation string', () => {
    expect(FACTORY_RESET_CONFIRM_PHRASE).toBe('NEWBORN');
  });
});
