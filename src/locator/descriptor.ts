/**
 * Five ways to find a control, tried in order. Resolution requires exactly one visible,
 * enabled match -- ambiguity is a failure, not a coin flip (see the resolver, not this file).
 *
 * Tiers: 1 role+name, 2 label/header proximity, 3 visible text, 4 structural path anchored
 * to a landmark, 5 coordinates relative to an anchor. Each strategy kind has exactly one
 * canonical tier, enforced below -- a candidate can't claim tier 1 confidence while
 * actually resolving by coordinates.
 */
import * as z from 'zod';
import { RoleSchema } from '../surface/observation';

/**
 * `framePath` is optional on every tier below structuralPath, not just declared on it:
 * frames routinely contain identically- or similarly-named controls (see Observation's
 * own framePath field), so any tier may need to scope itself to one frame to stay
 * unambiguous. Absent means "match in any frame."
 */
export const LocatorStrategySchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('roleAndName'),
    role: RoleSchema,
    name: z.string().min(1),
    exact: z.boolean().optional(),
    framePath: z.array(z.string()).optional(),
  }),
  z.object({
    strategy: z.literal('labelProximity'),
    labelText: z.string().min(1),
    direction: z.enum(['right', 'below', 'same-cell']),
    role: RoleSchema.optional(),
    framePath: z.array(z.string()).optional(),
  }),
  z.object({
    strategy: z.literal('visibleText'),
    text: z.string().min(1),
    role: RoleSchema.optional(),
    framePath: z.array(z.string()).optional(),
  }),
  z.object({ strategy: z.literal('structuralPath'), framePath: z.array(z.string()), path: z.string().min(1) }),
  z.object({ strategy: z.literal('anchoredCoordinates'), anchorName: z.string().min(1), dx: z.number(), dy: z.number() }),
]);
export type LocatorStrategy = z.infer<typeof LocatorStrategySchema>;

const TIER_BY_STRATEGY: Record<LocatorStrategy['strategy'], 1 | 2 | 3 | 4 | 5> = {
  roleAndName: 1,
  labelProximity: 2,
  visibleText: 3,
  structuralPath: 4,
  anchoredCoordinates: 5,
};

export const TierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type Tier = z.infer<typeof TierSchema>;

export const LocatorCandidateSchema = z
  .object({
    tier: TierSchema,
    confidence: z.number().min(0).max(1),
    /** Robustness reasoning. Required and non-empty -- this is the artifact's answer to "why is this identification stable". */
    note: z.string().min(1),
    locator: LocatorStrategySchema,
  })
  .refine((c) => c.tier === TIER_BY_STRATEGY[c.locator.strategy], {
    message: 'tier must match the canonical tier for this locator strategy',
    path: ['tier'],
  });
export type LocatorCandidate = z.infer<typeof LocatorCandidateSchema>;

export const LocatorDescriptorSchema = z.object({
  /** Ordered, best first. The resolver tries candidates in this order and stops at the first unique match. */
  candidates: z.array(LocatorCandidateSchema).min(1),
  /** The tier that actually resolved when this descriptor was recorded. Compared against resolvedTier on replay to detect drift. */
  recordedTier: TierSchema,
});
export type LocatorDescriptor = z.infer<typeof LocatorDescriptorSchema>;
