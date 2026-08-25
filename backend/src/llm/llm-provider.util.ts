/** Cloud LLM providers that work on Vercel/serverless (no local GPU). */
export const SERVERLESS_LLM_PROVIDERS = [
  'gemini',
  'openrouter',
  'groq',
  'xai',
  'claude',
] as const;

export type ServerlessLlmProvider = (typeof SERVERLESS_LLM_PROVIDERS)[number];

export function isServerlessLlmProvider(name: string): boolean {
  return SERVERLESS_LLM_PROVIDERS.includes(name as ServerlessLlmProvider);
}

export { resolvePreferredFreeProvider as resolveServerlessLlmProvider } from './free-provider-pool.util';
