const DERJA_LATIN =
  /\b(chno|chnawa|chnou|chnowa|kifech|kifeh|ta9|ta9es|9a9|9es|9ra9|3and|m3a|barcha|barsha|tawa|yosor|yesser|moch|mch|bch|behi|nheb|n7eb|s7i7|siidi|siidii|derja|tounes|tunis|tuns|lyoum|jaw|skhoun|safi|daraja|rtouba|i7ses|kif)\b|[3597]/i;

export function looksLikeDerjaLatin(text: string): boolean {
  const sample = text.trim();
  if (!sample || /[\u0600-\u06FF]/.test(sample)) {
    return false;
  }
  return DERJA_LATIN.test(sample);
}

export function detectSpeechLang(text: string): string {
  if (looksLikeDerjaLatin(text)) {
    return 'en-GB';
  }
  if (/[\u0600-\u06FF]/.test(text)) {
    return 'ar-EG';
  }
  if (/[àâäçéèêëîïôùûüœæ]/i.test(text)) {
    return 'fr-FR';
  }
  return 'en-GB';
}

export function shouldStreamSpeech(text: string): boolean {
  return !looksLikeDerjaLatin(text) && !/[\u0600-\u06FF]/.test(text);
}
