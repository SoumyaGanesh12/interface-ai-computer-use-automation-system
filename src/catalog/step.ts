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
  })
  .refine((s) => (s.kind === 'action' ? s.action !== undefined : s.escalateReason !== undefined), {
    message: 'action is required when kind is "action"; escalateReason is required when kind is "escalate"',
    path: ['action'],
  });
export type Step = z.infer<typeof StepSchema>;
