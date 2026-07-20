const DERJA_LATIN =
  /\b(chno|chnawa|chnou|chnowa|kifech|kifeh|ta9|ta9es|9a9|9es|9ra9|3and|m3a|barcha|barsha|tawa|yosor|yesser|moch|mch|bch|behi|nheb|n7eb|s7i7|siidi|siidii|derja|tounes|tunis|tuns|lyoum|jaw|skhoun|safi|daraja|rtouba|i7ses|kif)\b|[3597]/i;

const DERJA_ARABIC = /(?:برشا|باش|شنو|شنوة|توة|تونس|سيدي|كيفاش|بالحق|ماشي|ياسر|تو|هكا|برك|الجو)/;

export type LanguageMode = 'derja-latin' | 'derja-arabic' | 'french' | 'default';

export function looksLikeDerjaLatin(text: string): boolean {
  const sample = text.trim();
  if (!sample || /[\u0600-\u06FF]/.test(sample)) {
    return false;
  }
  return DERJA_LATIN.test(sample);
}

export function looksLikeDerjaArabic(text: string): boolean {
  const sample = text.trim();
  if (!sample || !/[\u0600-\u06FF]/.test(sample)) {
    return false;
  }
  return DERJA_ARABIC.test(sample);
}

export function looksLikeArabicScript(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function resolveLanguageMode(userText: string, recentUserTexts: string[] = []): LanguageMode {
  const texts = [userText, ...recentUserTexts].filter((t) => t?.trim());
  if (texts.some(looksLikeDerjaLatin)) {
    return 'derja-latin';
  }
  if (texts.some(looksLikeDerjaArabic)) {
    return 'derja-arabic';
  }
  if (texts.some((t) => looksLikeArabicScript(t) && !looksLikeDerjaArabic(t))) {
    return 'derja-arabic';
  }
  if (texts.some((t) => /[àâäçéèêëîïôùûüœæ]/i.test(t))) {
    return 'french';
  }
  return 'default';
}

const DERJA_LATIN_HINT =
  '\n\nLanguage directive (CRITICAL — failure to follow is unacceptable):\n' +
  'The user writes Tunisian Derja (Tunisian Arabic dialect) in Latin/Arabizi script.\n' +
  'You MUST reply ONLY in Tunisian Derja using Latin letters — NOT Modern Standard Arabic (فصحى), NOT Gulf/Saudi formal Arabic, NOT Arabic script.\n' +
  'FORBIDDEN example (MSA — never output this): "الجو في تونس اليوم صافي، 41 درجة، الإحساس 43، رطوبة 19%، ريح 12 كم/ساعة"\n' +
  'REQUIRED example (Tunisian Derja Latin): "Siidi, el jaw fi tounes lyoum safi, barsha skhoun — 41 daraja, i7ses kif 43, rtouba 19%, ri7 12 km/s."\n' +
  'Use Tunisian vocabulary: chnawa, lyoum, tounes, barsha, skhoun, safi, siidi, rtouba, ri7, daraja, tawa, kif, i7ses.\n' +
  'When tools return data (weather, calendar, etc.), translate all facts into Tunisian Derja Latin. Keep JARVIS tone.';

const DERJA_ARABIC_HINT =
  '\n\nLanguage directive (CRITICAL — failure to follow is unacceptable):\n' +
  'The user writes Tunisian Derja (Tunisian Arabic dialect), not formal MSA (فصحى) or Gulf Arabic.\n' +
  'Reply in Tunisian Derja using everyday Tunisian words and grammar — NOT news-anchor MSA.\n' +
  'FORBIDDEN (formal MSA): "الجو في تونس اليوم صافي، الإحساس 43، رطوبة، ريح"\n' +
  'REQUIRED (Tunisian Derja): "سيدي، الجو في تونس اليوم صافي، barsha skhoun — 41 درجة، يحس كيف 43، رطوبة 19%، ريح 12 km/s."\n' +
  'Use Tunisian forms: برشا، توة، كيفاش، سيدي، lyoum. When tools return data, present facts in Derja. Keep JARVIS tone.';

const FRENCH_HINT = '\n\nLanguage directive: Reply in French with JARVIS tone. Use monsieur when natural.';

export function buildLanguageHint(userText: string, recentUserTexts: string[] = []): string {
  switch (resolveLanguageMode(userText, recentUserTexts)) {
    case 'derja-latin':
      return DERJA_LATIN_HINT;
    case 'derja-arabic':
      return DERJA_ARABIC_HINT;
    case 'french':
      return FRENCH_HINT;
    default:
      return '';
  }
}

export function buildToolResultLanguageReminder(mode: LanguageMode): string {
  if (mode === 'derja-latin') {
    return '\n\n[Present this to the user in Tunisian Derja Latin (Arabizi) only — never MSA Arabic script.]';
  }
  if (mode === 'derja-arabic') {
    return '\n\n[Present this to the user in Tunisian Derja — not formal MSA.]';
  }
  return '';
}
