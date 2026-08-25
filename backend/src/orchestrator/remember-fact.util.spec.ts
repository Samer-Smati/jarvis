import {
  extractAlsoBrainFlag,
  extractIdentityPreferences,
  extractRememberFactText,
  formatRememberFactReply,
  resolvePreferenceWrites,
} from './remember-fact.util';

describe('remember-fact.util', () => {
  it('reads the canonical fact field', () => {
    expect(extractRememberFactText({ fact: ' User likes tea. ' })).toBe('User likes tea.');
  });

  it('accepts common aliases when fact is missing', () => {
    expect(extractRememberFactText({ text: 'Name is Samer' })).toBe('Name is Samer');
  });

  it('parses identity fields from prose into preference keys', () => {
    const prefs = extractIdentityPreferences(
      'Samer Smati is a full-stack developer, formerly at ArabyAds (AdTech company, Dubai), with GCC & MENA region production experience.',
    );
    expect(prefs).toEqual(
      expect.arrayContaining([
        { key: 'user.name', value: 'Samer Smati' },
        { key: 'user.role', value: 'full-stack developer' },
        { key: 'user.former_employer', value: 'ArabyAds' },
        { key: 'user.industry', value: 'AdTech' },
        { key: 'user.region', value: 'GCC/MENA (Dubai)' },
      ]),
    );
    expect(prefs).toHaveLength(5);
  });

  it('prefers explicit preferences map over prose parsing', () => {
    const writes = resolvePreferenceWrites(
      { preferences: { 'user.name': 'Samer Smati' }, fact: 'ignored blob' },
      'ignored blob',
    );
    expect(writes).toEqual([{ key: 'user.name', value: 'Samer Smati' }]);
  });

  it('defaults also_brain to false', () => {
    expect(extractAlsoBrainFlag({})).toBe(false);
    expect(extractAlsoBrainFlag({ also_brain: true })).toBe(true);
  });

  it('formats an honest reply with ids and vault status', () => {
    const text = formatRememberFactReply({
      preferenceRows: [{ id: 'p1', key: 'user.name', value: 'Samer Smati' }],
      semanticRows: [{ id: 's1', text: 'user.name: Samer Smati', memoryType: 'preference' }],
    });
    expect(text).toContain('user_preferences');
    expect(text).toContain('p1');
    expect(text).toContain('Brain vault was not updated');
    expect(text).not.toMatch(/and JARVIS brain wiki/i);
  });
});
