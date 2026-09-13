/**
 * One step in a capability's flow, shared by the main sequence and a recovery
 * sub-flow's `runSteps`. `kind: 'escalate'` gives a human-performed segment (recorded
 * during discovery) an honest representation -- a declared pause, not a failure and not
 * a fabricated action nobody's locator candidates actually observed.
 */
import * as z from 'zod';
import { ActionSchema } from '../surface/action';
import { MatcherSchema } from '../matcher/types';

export const IdempotencySpecSchema = z.object({
  /** Consulted only when a restart finds this step dispatched without confirmed -- never a general precondition check. */
  probe: MatcherSchema,
  key: z.string().min(1),
  navigateTo: z.string().optional(),
});
export type IdempotencySpec = z.infer<typeof IdempotencySpecSchema>;

/**
 * An explicit, opt-in precondition, distinct from IdempotencySpec: that probe is
 * consulted only inside this run's own crash/retry window (see its own doc comment) --
 * conflating the two would reintroduce the exact bug that scoping was built to avoid,
 * a probe that finds an old, legitimate result and mistakes it for the run's own
 * duplicate. This is checked once, before the very first dispatch attempt of an
 * irreversible step, only when the step's own author has declared it: an approved
 * capability still acts unattended by default, this is a per-capability choice to check
 * the world first for actions where that's worth the cost.
 */
export const StepPrecheckSchema = z.object({
  detect: MatcherSchema,
  code: z.string().min(1),
  message: z.string().min(1),
});
export type StepPrecheck = z.infer<typeof StepPrecheckSchema>;

export const StepSchema = z
  .object({
    /** Stable; referenced by output afterStep and by override insertAfter. */
    id: z.string().min(1),
    intent: z.string().min(1),
    kind: z.enum(['action', 'escalate']),
    action: ActionSchema.optional(),
    escalateReason: z.string().optional(),
    wait: MatcherSchema.optional(),
    checkpoint: MatcherSchema,
    risk: z.enum(['safe', 'irreversible']),
    idempotency: IdempotencySpecSchema.optional(),
    precheck: StepPrecheckSchema.optional(),
  })
  .refine((s) => (s.kind === 'action' ? s.action !== undefined : s.escalateReason !== undefined), {
    message: 'action is required when kind is "action"; escalateReason is required when kind is "escalate"',
    path: ['action'],
  });
export type Step = z.infer<typeof StepSchema>;
