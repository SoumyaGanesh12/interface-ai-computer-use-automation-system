/**
 * Model identity (baseURL, model id, API key) is never hardcoded in src/ -- all three
 * come from the environment, with no fallback default, so swapping providers is purely
 * a config change. Only tuning knobs (token limits, budget) get defaults.
 */
export interface ModelConfig {
  baseURL: string;
  modelId: string;
  apiKey: string;
  maxTokens: number;
  maxTokensPerRun: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see .env.example)`);
  return value;
}

export function loadModelConfig(): ModelConfig {
  return {
    baseURL: requireEnv('GEMINI_BASE_URL'),
    modelId: requireEnv('GEMINI_MODEL_ID'),
    apiKey: requireEnv('GEMINI_API_KEY'),
    maxTokens: Number(process.env.GEMINI_MAX_TOKENS ?? 2048),
    maxTokensPerRun: Number(process.env.GEMINI_MAX_TOKENS_PER_RUN ?? 80000),
  };
}
