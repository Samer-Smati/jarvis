/** Short greetings / acks — skip tool definitions on serverless for faster first token. */
export function isFastChatTurn(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 36) {
    return false;
  }
  if (/\b(search|weather|calendar|remind|email|upgrade|update|deploy|github|code|fix|build|self.?improve)\b/i.test(t)) {
    return false;
  }
  return /^(hey|hi|hello|yo|hiya|howdy|salut|bonjour|bonsoir|ahlan|marhaba|ca va|ça va|ok|okay|thanks|thank you|merci|good morning|good afternoon|good evening|what'?s up|sup)\b/i.test(
    t,
  );
}

export function isServerlessRuntime(): boolean {
  return !!process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1';
}

/** User asks what can be upgraded — status only, no inspect spam. */
export function isSelfImproveInfoQuery(text: string): boolean {
  const t = text.trim();
  return /\b(what can you upgrade|what.*upgrade.*(yourself|first|now)|what updates|what do you need|upgrade yourself first|what can you change)\b/i.test(
    t,
  );
}
