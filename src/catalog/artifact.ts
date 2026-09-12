/**
 * The capability contract: what an artifact declares about itself so a human reviewer
 * and a calling agent can both understand what it does, what it needs, and what it
 * returns -- without reading the raw discovery transcript.
 *
 * `artifactSchemaVersion` is checked before this schema ever runs (see ./validate.ts);
 * it is the on-disk format's version, not the capability's own semver.
 */
import * as z from 'zod';
import { StepSchema } from './step';
import { RecoveryStrategySchema } from './recovery';
import { MatcherSchema } from '../matcher/types';
import { ExtractionSchema } from '../matcher/extraction';

export const ValueTypeSchema = z.enum(['string', 'integer', 'number', 'boolean', 'currency', 'date']);
export type ValueType = z.infer<typeof ValueTypeSchema>;

const ACTION_KINDS = ['navigate', 'click', 'type', 'typeCredential', 'select', 'read'] as const;

export const ArtifactSchema = z
  .object({
    artifactSchemaVersion: z.literal(1),
    capability: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      semver: z.string().min(1),
      description: z.string().min(1),
    }),
    surface: z.object({
      kind: z.literal('web'),
      app: z.string().min(1),
      appVersion: z.string().min(1),
      /** "base" on the artifact an override patches; the variant id on an override file. */
      variant: z.string().min(1),
    }),
    requires: z.object({ authenticated: z.boolean() }),
    approval: z.object({
      state: z.enum(['draft', 'approved']),
      verifiedRuns: z.number().int().nonnegative(),
      lastVerifiedAt: z.string().optional(),
    }),
    inputs: z.array(
      z.object({
        name: z.string().min(1),
        type: ValueTypeSchema,
        required: z.boolean(),
        redact: z.boolean(),
        description: z.string().min(1),
      }),
    ),
    outputs: z.array(
      z.object({
        name: z.string().min(1),
        type: ValueTypeSchema,
        nullable: z.boolean(),
        afterStep: z.string().min(1),
        extraction: ExtractionSchema,
        description: z.string().min(1),
      }),
    ),
    steps: z.array(StepSchema).min(1),
    outcomes: z.array(z.object({ code: z.string().min(1), detect: MatcherSchema, message: z.string().min(1) })),
    recovery: z.array(
      z.object({
        code: z.string().min(1),
        detect: MatcherSchema,
        strategy: RecoveryStrategySchema,
        maxAttempts: z.number().int().positive(),
      }),
    ),
    policy: z.object({
      allowedOrigins: z.array(z.string().min(1)),
      allowedActions: z.array(z.enum(ACTION_KINDS)),
    }),
    /** Records the model but creates no dependency on it -- no transcript. */
    provenance: z.object({
      discoveredAt: z.string(),
      model: z.string().min(1),
      runId: z.string().min(1),
      humanAssisted: z.boolean(),
    }),
  })
  .superRefine((artifact, ctx) => {
    const stepIds = new Set(artifact.steps.map((s) => s.id));
    if (stepIds.size !== artifact.steps.length) {
      ctx.addIssue({ code: 'custom', message: 'step ids must be unique', path: ['steps'] });
    }
    artifact.outputs.forEach((output, i) => {
      if (!stepIds.has(output.afterStep)) {
        ctx.addIssue({ code: 'custom', message: `afterStep "${output.afterStep}" does not match any step id`, path: ['outputs', i, 'afterStep'] });
      }
    });
    const outcomeCodes = new Set(artifact.outcomes.map((o) => o.code));
    if (outcomeCodes.size !== artifact.outcomes.length) {
      ctx.addIssue({ code: 'custom', message: 'outcome codes must be unique', path: ['outcomes'] });
    }
    const recoveryCodes = new Set(artifact.recovery.map((r) => r.code));
    if (recoveryCodes.size !== artifact.recovery.length) {
      ctx.addIssue({ code: 'custom', message: 'recovery codes must be unique', path: ['recovery'] });
    }
  });
export type Artifact = z.infer<typeof ArtifactSchema>;
