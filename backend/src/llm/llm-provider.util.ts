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

/** Pick the best configured cloud provider from env (first key wins). */
export function resolveServerlessLlmProvider(): string {
  if (process.env.LLM_PROVIDER && isServerlessLlmProvider(process.env.LLM_PROVIDER)) {
    return process.env.LLM_PROVIDER;
  }
  if (process.env.GEMINI_API_KEY?.trim()) {
    return 'gemini';
  }
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    return 'openrouter';
  }
  if (process.env.GROQ_API_KEY?.trim()) {
    return 'groq';
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return 'claude';
  }
  if (process.env.XAI_API_KEY?.trim()) {
    return 'xai';
  }
  return process.env.LLM_PROVIDER ?? 'gemini';
}
