import { extractRememberFactText } from './remember-fact.util';

describe('extractRememberFactText', () => {
  it('reads the canonical fact field', () => {
    expect(extractRememberFactText({ fact: ' User likes tea. ' })).toBe('User likes tea.');
  });

  it('accepts common aliases when fact is missing', () => {
    expect(extractRememberFactText({ text: 'Name is Samer' })).toBe('Name is Samer');
    expect(extractRememberFactText({ content: 'Works in AdTech' })).toBe('Works in AdTech');
    expect(extractRememberFactText({ memory: 'Prefers Derja' })).toBe('Prefers Derja');
  });

  it('returns empty when nothing usable was provided', () => {
    expect(extractRememberFactText({})).toBe('');
    expect(extractRememberFactText({ fact: '   ' })).toBe('');
    expect(extractRememberFactText(undefined)).toBe('');
  });
});
