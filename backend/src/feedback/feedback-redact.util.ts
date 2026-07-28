const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const API_KEY_PATTERN = /\b(sk-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{20,})\b/g;

export function redactSensitive(text: string): string {
  return text.replace(EMAIL_PATTERN, '[email]').replace(API_KEY_PATTERN, '[redacted-key]');
}
