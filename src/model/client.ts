/**
 * The provider seam sits at the OpenAI-compatible chat-completions wire shape, not a
 * vendor SDK's tool-calling format -- swapping providers later means changing baseURL
 * and a model id, not this interface. Constrained JSON output (response_format:
 * json_object), not native tool-calling: the loop is ours, there is no multi-turn tool
 * orchestration to delegate, and tool-calling would only wrap a payload we validate
 * ourselves anyway in a vendor-specific envelope.
 */
export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  /** The only trustworthy total: measured against gemini-3.6-flash, totalTokens exceeded
   * promptTokens + completionTokens by ~345 (invisible thinking tokens); summing the
   * visible two under-counts a budget by roughly half. */
  totalTokens: number;
}

export interface ModelResponse {
  text: string;
  usage: ModelUsage;
}

export interface ModelClient {
  complete(prompt: string): Promise<ModelResponse>;
}

/** Transient; the caller should back off and retry. */
export class ModelRateLimitError extends Error {}
/** Not transient for the remainder of this run; the caller should stop, not retry. */
export class ModelQuotaExceededError extends Error {}
