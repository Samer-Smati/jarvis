const DERJA_LATIN =
  /\b(chno|chnawa|chnou|kifech|kifeh|ta9|9a9|9ra9|3and|m3a|barcha|barsha|tawa|yosor|yesser|moch|mch|bch|behi|nheb|n7eb|s7i7|siidi|siidii|derja|tounes|tunis|tuns)\b|[3597]/i;

export function looksLikeDerjaLatin(text: string): boolean {
  const sample = text.trim();
  if (!sample || /[\u0600-\u06FF]/.test(sample)) {
    return false;
  }
  return DERJA_LATIN.test(sample);
}

export function looksLikeArabicScript(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function buildLanguageHint(userText: string): string {
  if (looksLikeArabicScript(userText)) {
    return (
      '\n\nLanguage directive (mandatory): The user is using Arabic script. Reply in Tunisian Derja ' +
      '(Tunisian Arabic), not formal MSA unless they used MSA. Keep JARVIS tone. Use سيدي for sir.'
    );
  }
  if (looksLikeDerjaLatin(userText)) {
    return (
      '\n\nLanguage directive (mandatory): The user is writing Tunisian Derja in Latin/transliterated form ' +
      '(e.g. chnawa, ta9es, barcha). Reply in Tunisian Derja in the SAME script style they used. ' +
      'If they used Latin, reply in natural Tunisian Latin; if Arabic script, use Arabic script. ' +
      'Include tool facts (weather numbers, etc.) in Derja. Use siidi/sidi for sir.'
    );
  }
  if (/[àâäçéèêëîïôùûüœæ]/i.test(userText)) {
    return '\n\nLanguage directive: Reply in French with JARVIS tone. Use monsieur when natural.';
  }
  return '';
}
