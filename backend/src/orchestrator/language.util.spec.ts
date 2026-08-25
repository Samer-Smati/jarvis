import {
  buildLanguageHint,
  buildToolResultLanguageReminder,
  looksLikeDerjaArabic,
  looksLikeDerjaLatin,
  resolveLanguageMode,
} from './language.util';

describe('looksLikeDerjaLatin', () => {
  it('detects genuine Tunisian Derja markers', () => {
    expect(looksLikeDerjaLatin('chnawa el ta9es fi tounes tawa')).toBe(true);
    expect(looksLikeDerjaLatin('barsha skhoun lyoum')).toBe(true);
  });

  it('does not misfire on English mentioning the city Tunis', () => {
    expect(
      looksLikeDerjaLatin(
        "What's the weather in Tunis right now, and also search the web for today's top tech news headline?",
      ),
    ).toBe(false);
  });

  it('does not misfire on a bare digit (price, phone number, time)', () => {
    expect(looksLikeDerjaLatin('What is 9 + 5?')).toBe(false);
    expect(looksLikeDerjaLatin('Call me at 3pm')).toBe(false);
  });
});

describe('resolveLanguageMode', () => {
  it('stays default for an English weather question mentioning Tunis', () => {
    expect(
      resolveLanguageMode("What's the weather in Tunis right now, and also search the web for today's top tech news headline?"),
    ).toBe('default');
  });

  it('still detects real Derja Latin requests', () => {
    expect(resolveLanguageMode('chnawa ta9es fi tounes tawa')).toBe('derja-latin');
  });

  it('still detects Derja Arabic script', () => {
    expect(resolveLanguageMode('شنو الجو في تونس')).toBe('derja-arabic');
  });
});

describe('buildLanguageHint', () => {
  it('returns no hint for a plain English question about Tunis', () => {
    expect(buildLanguageHint("What's the weather in Tunis right now?")).toBe('');
  });

  it('returns the Derja hint for real Derja input', () => {
    expect(buildLanguageHint('chnawa ta9es fi tounes tawa')).toMatch(/Tunisian Derja/);
  });
});

describe('buildToolResultLanguageReminder', () => {
  it('is empty for default mode', () => {
    expect(buildToolResultLanguageReminder('default')).toBe('');
  });

  it('reminds to present in Derja Latin for that mode', () => {
    expect(buildToolResultLanguageReminder('derja-latin')).toMatch(/Derja Latin/);
  });
});

describe('looksLikeDerjaArabic', () => {
  it('is false for Latin script', () => {
    expect(looksLikeDerjaArabic('hello there')).toBe(false);
  });
});
