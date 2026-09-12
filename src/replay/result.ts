/**
 * Three-way at the top level, not nested under an error type: success, a known business
 * outcome, or a failure with enough detail to debug. "output_extraction" is distinct
 * from every other failure -- all steps and the checkpoint passed, but a declared output
 * could not be read out. Never `{ status: 'success', outputs: { balance: null } }`.
 */
export interface ReplayResult {
  status: 'success' | 'business_outcome' | 'failure';
  capability: string;
  version: string;
  runId: string;
  durationMs: number;
  outputs?: Record<string, unknown>;
  outcome?: { code: string; message: string };
  failure?: {
    kind:
      | 'locator_unresolved'
      | 'locator_ambiguous'
      | 'checkpoint_failed'
      | 'output_extraction'
      | 'policy_denied'
      | 'recovery_exhausted'
      /** Nobody answered within the configured window -- one intervention, unanswered. */
      | 'escalation_timeout'
      /** Distinct from escalation_timeout: this run has hit its per-run escalation cap. Answered every time, still structurally unable to finish unattended. */
      | 'escalation_limit'
      | 'idempotency_ambiguous'
      | 'budget_exceeded'
      | 'hard';
    stepId: string;
    intent: string;
    expected: string;
    observed: string;
    /** Screenshot path from Surface.capture(), best-effort. */
    evidenceRef: string;
  };
  locatorTiers: Array<{ stepId: string; recordedTier: number; resolvedTier: number }>;
  recoveries: Array<{ code: string; attempts: number }>;
  /** resolvedTier > recordedTier: replay still succeeded, this is a signal, not a failure. */
  drift: Array<{ stepId: string; recordedTier: number; resolvedTier: number }>;
  humanInterventions: Array<{ stepId: string; reason: string; durationMs: number }>;
}
