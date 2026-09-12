/**
 * How a recovery entry remediates a detected condition. `runSteps` inlines its own
 * flow (reusing Step) rather than a closed enum like `reauthenticate` -- the engine
 * never needs to know what re-auth means, only how to run steps it's given.
 * `preflight` instead runs the app's configured login flow (config.apps[<id>].preflight,
 * matched on the artifact's surface.app) so every capability doesn't duplicate its own
 * copy of the login sequence -- not wired up until config-loading exists.
 *
 * Every runSteps step must be risk:'safe'. An automatic retry path must never be able
 * to fire an irreversible action.
 */
import * as z from 'zod';
import { StepSchema } from './step';

export const RecoveryStrategySchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('runSteps'), steps: z.array(StepSchema).min(1) })
    .refine((s) => s.steps.every((step) => step.risk === 'safe'), {
      message: 'every step in a recovery runSteps sub-flow must be risk: "safe"',
      path: ['steps'],
    }),
  z.object({ kind: z.literal('preflight') }),
]);
export type RecoveryStrategy = z.infer<typeof RecoveryStrategySchema>;
