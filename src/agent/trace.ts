/** The record a compiler turns into an artifact. Decoupled from the raw model prompt/response text -- only the decision, the resolved action, and the outcome survive. */
import type { Action } from '../surface/action';
import type { Tier } from '../locator/descriptor';

export interface TraceStep {
  stepIndex: number;
  source: 'preflight' | 'model';
  rationale: string;
  intent: string;
  /** Absent when the decision couldn't even be turned into a dispatchable action (an unknown targetNodeId, an unresolvable locator, "stuck"). */
  action?: Action;
  observationHash: string;
  result: 'ok' | 'failed';
  detail?: string;
  resolvedTier?: Tier;
  readValue?: string;
}

export interface TraceFile {
  runId: string;
  goal: string;
  target: string;
  model: string;
  startedAt: string;
  finishedAt: string;
  status: string;
  outputs?: Record<string, string>;
  reason?: string;
  totalTokens: number;
  steps: TraceStep[];
}
