/**
 * The one ModelClient implementation: any OpenAI-compatible chat-completions endpoint.
 * Swapping providers is a config change (baseURL + model id), never a code change here.
 *
 * Rate-limit vs. quota-exhausted classification on a 429 is a best-effort heuristic
 * (no rate-limit headers were returned when this endpoint was probed, so proactive
 * checking isn't possible) -- inspects the error body for a quota-style message.
 * Retry/backoff policy itself lives in the discovery loop, not here: this module only
 * translates the wire response and classifies failures, since stopping conditions are
 * the loop's concern.
 */
import OpenAI from 'openai';
import { ModelQuotaExceededError, ModelRateLimitError, type ModelClient, type ModelResponse } from './client';

export interface OpenAiCompatibleConfig {
  baseURL: string;
  modelId: string;
  apiKey: string;
  maxTokens: number;
}

function isQuotaExhausted(message: string): boolean {
  return /quota|resource_exhausted|exceeded your current/i.test(message);
}

export function createOpenAiCompatibleClient(config: OpenAiCompatibleConfig): ModelClient {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });

  return {
    async complete(prompt: string): Promise<ModelResponse> {
      try {
        const response = await client.chat.completions.create({
          model: config.modelId,
          max_tokens: config.maxTokens,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        });
        const text = response.choices[0]?.message.content ?? '';
        const usage = response.usage;
        return {
          text,
          usage: {
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
            totalTokens: usage?.total_tokens ?? 0,
          },
        };
      } catch (err) {
        if (err instanceof OpenAI.APIError && err.status === 429) {
          const message = err.message ?? '';
          if (isQuotaExhausted(message)) throw new ModelQuotaExceededError(message);
          throw new ModelRateLimitError(message);
        }
        throw err;
      }
    },
  };
}
